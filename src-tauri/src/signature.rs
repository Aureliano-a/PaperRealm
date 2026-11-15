use crate::Database;
use base64::Engine;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;
const CHUNK: usize = 384 * 1024;
const LIMIT: usize = 128 * 1024 * 1024;
static BUSY: AtomicBool = AtomicBool::new(false);
struct Permit;
impl Drop for Permit {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}
struct Source<'a> {
    conn: &'a Connection,
    id: &'a str,
    length: usize,
    legacy: bool,
}
impl<'a> Source<'a> {
    fn new(conn: &'a Connection, id: &'a str) -> Result<Self, String> {
        let blob = crate::source_blob(conn, id)?;
        let len = blob.len();
        if len < 2 {
            return Err("SIG_SOURCE".into());
        }
        let mut first = [0];
        blob.read_at_exact(&mut first, 0)
            .map_err(|e| e.to_string())?;
        if first[0] == b'"' {
            let count = len - 2;
            if count < 4 || count % 4 != 0 {
                return Err("SIG_SOURCE".into());
            }
            let mut tail = [0; 2];
            blob.read_at_exact(&mut tail, len - 3)
                .map_err(|e| e.to_string())?;
            let padding = if tail == [b'=', b'='] {
                2
            } else if tail[1] == b'=' {
                1
            } else {
                0
            };
            return Ok(Self {
                conn,
                id,
                length: count / 4 * 3 - padding,
                legacy: true,
            });
        }
        if len > 1048576 {
            return Err("SIG_SOURCE".into());
        }
        let mut bytes = vec![0; len];
        blob.read_at_exact(&mut bytes, 0)
            .map_err(|e| e.to_string())?;
        let v: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let length = v["length"].as_u64().ok_or("SIG_SOURCE")? as usize;
        let parts = v["parts"].as_u64().ok_or("SIG_SOURCE")? as usize;
        if v["version"] != 1 || parts != length.checked_add(CHUNK - 1).ok_or("SIG_SOURCE")? / CHUNK
        {
            return Err("SIG_SOURCE".into());
        }
        Ok(Self {
            conn,
            id,
            length,
            legacy: false,
        })
    }
    fn read(&self, start: usize, length: usize) -> Result<Vec<u8>, String> {
        let end = start.checked_add(length).ok_or("SIG_RANGE")?;
        if end > self.length || length > LIMIT {
            return Err("SIG_LIMIT".into());
        }
        let mut result = Vec::with_capacity(length);
        let mut at = start;
        while at < end {
            let index = at / CHUNK;
            let expected = CHUNK.min(self.length - index * CHUNK);
            let encoded = if self.legacy {
                let blob = crate::source_blob(self.conn, self.id)?;
                let mut data = vec![0; (expected + 2) / 3 * 4];
                blob.read_at_exact(&mut data, 1 + index * CHUNK / 3 * 4)
                    .map_err(|e| e.to_string())?;
                String::from_utf8(data).map_err(|e| e.to_string())?
            } else {
                let value: String = self
                    .conn
                    .query_row(
                        "SELECT value FROM records WHERE key=?1",
                        [format!("source-part:{}:{}", self.id, index)],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                serde_json::from_str::<String>(&value).map_err(|e| e.to_string())?
            };
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|_| "SIG_SOURCE")?;
            if bytes.len() != expected {
                return Err("SIG_SOURCE".into());
            }
            let offset = at - index * CHUNK;
            let take = (end - at).min(expected - offset);
            result.extend_from_slice(&bytes[offset..offset + take]);
            at += take;
        }
        Ok(result)
    }
}
fn der_length(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 2 || bytes[0] != 0x30 {
        return None;
    }
    let first = bytes[1];
    let (head, length): (usize, usize) = if first < 128 {
        (2, first as usize)
    } else {
        let n = (first & 127) as usize;
        if n == 0 || n > 4 || bytes.len() < 2 + n {
            return None;
        }
        let mut size = 0usize;
        for b in &bytes[2..2 + n] {
            size = size.checked_mul(256)?.checked_add(*b as usize)?;
        }
        (2 + n, size)
    };
    let total = head.checked_add(length)?;
    if total > bytes.len() || bytes[total..].iter().any(|b| *b != 0) {
        None
    } else {
        Some(total)
    }
}
fn hex_contents(gap: &[u8]) -> Option<Vec<u8>> {
    let trimmed = gap
        .iter()
        .copied()
        .filter(|c| !c.is_ascii_whitespace())
        .collect::<Vec<_>>();
    if trimmed.len() < 2
        || trimmed[0] != b'<'
        || *trimmed.last()? != b'>'
        || trimmed.get(1) == Some(&b'<')
    {
        return None;
    }
    let raw = &trimmed[1..trimmed.len() - 1];
    if raw.len() % 2 != 0 {
        return None;
    }
    raw.chunks(2)
        .map(|p| {
            let a = (p[0] as char).to_digit(16)?;
            let b = (p[1] as char).to_digit(16)?;
            Some((a * 16 + b) as u8)
        })
        .collect()
}

#[cfg(windows)]
fn verify_crypto(cms: &[u8], first: &[u8], second: &[u8]) -> Value {
    use windows::Win32::Security::Cryptography::*;
    unsafe {
        let para = CRYPT_VERIFY_MESSAGE_PARA {
            cbSize: std::mem::size_of::<CRYPT_VERIFY_MESSAGE_PARA>() as u32,
            dwMsgAndCertEncodingType: X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0,
            ..Default::default()
        };
        let pointers = [first.as_ptr(), second.as_ptr()];
        let sizes = [first.len() as u32, second.len() as u32];
        let mut cert = std::ptr::null_mut();
        if let Err(error) = CryptVerifyDetachedMessageSignature(
            &para,
            0,
            cms,
            2,
            pointers.as_ptr(),
            sizes.as_ptr(),
            Some(&mut cert),
        ) {
            if !cert.is_null() {
                let _ = CertFreeCertificateContext(Some(cert));
            }
            return json!({"cryptoValid":false,"cryptoError":format!("0x{:08X}",error.code().0 as u32)});
        }
        if cert.is_null() {
            return json!({"cryptoValid":true,"chainTrusted":false,"revocation":"unknown","chainError":"NO_CERT"});
        }
        struct Cert(*const CERT_CONTEXT);
        impl Drop for Cert {
            fn drop(&mut self) {
                unsafe {
                    let _ = CertFreeCertificateContext(Some(self.0));
                }
            }
        }
        let _cert = Cert(cert);
        fn name(cert: *const CERT_CONTEXT, flags: u32) -> String {
            unsafe {
                let length =
                    CertGetNameStringW(cert, CERT_NAME_SIMPLE_DISPLAY_TYPE, flags, None, None);
                if length == 0 || length > 10000 {
                    return String::new();
                }
                let mut text = vec![0u16; length as usize];
                CertGetNameStringW(
                    cert,
                    CERT_NAME_SIMPLE_DISPLAY_TYPE,
                    flags,
                    None,
                    Some(&mut text),
                );
                String::from_utf16_lossy(&text[..text.len().saturating_sub(1)])
            }
        }
        fn chain(cert: *const CERT_CONTEXT, revocation: bool) -> (bool, u32, u32) {
            unsafe {
                let parameters = CERT_CHAIN_PARA {
                    cbSize: std::mem::size_of::<CERT_CHAIN_PARA>() as u32,
                    ..Default::default()
                };
                let mut context = std::ptr::null_mut();
                let flags = CERT_CHAIN_CACHE_ONLY_URL_RETRIEVAL
                    | CERT_CHAIN_DISABLE_AUTH_ROOT_AUTO_UPDATE
                    | CERT_CHAIN_DISABLE_AIA
                    | if revocation {
                        CERT_CHAIN_REVOCATION_CHECK_CACHE_ONLY
                            | CERT_CHAIN_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT
                    } else {
                        0
                    };
                if CertGetCertificateChain(
                    None,
                    cert,
                    None,
                    Some((*cert).hCertStore),
                    &parameters,
                    flags,
                    None,
                    &mut context,
                )
                .is_err()
                    || context.is_null()
                {
                    return (false, u32::MAX, u32::MAX);
                }
                let trust = (*context).TrustStatus.dwErrorStatus;
                let policy = CERT_CHAIN_POLICY_PARA {
                    cbSize: std::mem::size_of::<CERT_CHAIN_POLICY_PARA>() as u32,
                    ..Default::default()
                };
                let mut status = CERT_CHAIN_POLICY_STATUS {
                    cbSize: std::mem::size_of::<CERT_CHAIN_POLICY_STATUS>() as u32,
                    ..Default::default()
                };
                let ok = CertVerifyCertificateChainPolicy(
                    CERT_CHAIN_POLICY_BASE,
                    context,
                    &policy,
                    &mut status,
                )
                .as_bool();
                CertFreeCertificateChain(context);
                (
                    ok && status.dwError == 0 && trust == 0,
                    trust,
                    status.dwError,
                )
            }
        }
        let (trusted, trust, policy) = chain(cert, false);
        let (_, revocation, _) = chain(cert, true);
        let rev = if revocation == u32::MAX {
            "unknown"
        } else if revocation & 4 != 0 {
            "revoked"
        } else if revocation == 0 {
            "clear_cached"
        } else {
            "unknown"
        };
        let info = (*cert).pCertInfo;
        let dates = if info.is_null() {
            (0i64, 0i64)
        } else {
            let before = (*info).NotBefore;
            let after = (*info).NotAfter;
            (
                (((before.dwHighDateTime as u64) << 32 | before.dwLowDateTime as u64) / 10000)
                    as i64
                    - 11644473600000,
                (((after.dwHighDateTime as u64) << 32 | after.dwLowDateTime as u64) / 10000) as i64
                    - 11644473600000,
            )
        };
        // Export only the public signer certificate, never a private key.
        let encoded = if !(*cert).pbCertEncoded.is_null() && (*cert).cbCertEncoded <= 1024 * 1024 {
            std::slice::from_raw_parts((*cert).pbCertEncoded, (*cert).cbCertEncoded as usize)
        } else { &[] };
        let mut hash = [0u8; 32];
        let mut hash_len = hash.len() as u32;
        let fingerprint = if !encoded.is_empty() && CryptHashCertificate2(
            windows::core::w!("SHA256"), 0, None, Some(encoded), Some(hash.as_mut_ptr()), &mut hash_len,
        ).is_ok() && hash_len == 32 {
            hash.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
        } else { String::new() };
        let serial = if !info.is_null() && !(*info).SerialNumber.pbData.is_null() && (*info).SerialNumber.cbData <= 1024 {
            std::slice::from_raw_parts((*info).SerialNumber.pbData, (*info).SerialNumber.cbData as usize)
                .iter().rev().map(|b| format!("{b:02X}")).collect::<String>()
        } else { String::new() };
        json!({"cryptoValid":true,"chainTrusted":trusted,"chainError":format!("0x{trust:08X}"),"policyError":format!("0x{policy:08X}"),"subject":name(cert,0),"issuer":name(cert,CERT_NAME_ISSUER_FLAG),"notBefore":dates.0,"notAfter":dates.1,"revocation":rev,"certificateDer":base64::engine::general_purpose::STANDARD.encode(encoded),"certificateSha256":fingerprint,"certificateSerial":serial})
    }
}

#[tauri::command]
pub async fn verify_pdf_signature(
    db: State<'_, Database>,
    id: String,
    ranges: Vec<u64>,
    cms: String,
    subfilter: String,
) -> Result<Value, String> {
    if ranges.len() != 4 || cms.len() > 2 * 1024 * 1024 || ranges[0] != 0 {
        return Err("SIG_RANGE".into());
    }
    if !matches!(
        subfilter.as_str(),
        "adbe.pkcs7.detached" | "ETSI.CAdES.detached"
    ) {
        return Err("SIG_SUBFILTER".into());
    }
    if BUSY
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("SIG_BUSY".into());
    }
    let permit = Permit;
    let database = db.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let contents = base64::engine::general_purpose::STANDARD
            .decode(cms)
            .map_err(|_| "SIG_CMS")?;
        let der = der_length(&contents).ok_or("SIG_CMS")?;
        let (first, second, length, end) = {
            let path = {
                let guard = database.lock().map_err(|e| e.to_string())?;
                guard.path().ok_or("SIG_SOURCE")?.to_owned()
            };
            let conn = Connection::open_with_flags(
                path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                    | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(|e| e.to_string())?;
            conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
            let source = Source::new(&conn, &id)?;
            let a = usize::try_from(ranges[1]).map_err(|_| "SIG_RANGE")?;
            let b = usize::try_from(ranges[2]).map_err(|_| "SIG_RANGE")?;
            let c = usize::try_from(ranges[3]).map_err(|_| "SIG_RANGE")?;
            let end = b.checked_add(c).ok_or("SIG_RANGE")?;
            if a == 0
                || b <= a
                || end > source.length
                || a.checked_add(c).ok_or("SIG_LIMIT")? > LIMIT
                || b - a > 2 * 1024 * 1024
            {
                return Err("SIG_RANGE".into());
            }
            let gap = source.read(a, b - a)?;
            if hex_contents(&gap).as_deref() != Some(contents.as_slice()) {
                return Err("SIG_CONTENTS_MISMATCH".into());
            }
            (source.read(0, a)?, source.read(b, c)?, source.length, end)
        };
        #[cfg(windows)]
        let mut result = verify_crypto(&contents[..der], &first, &second);
        #[cfg(not(windows))]
        let mut result = {
            let _ = (&contents, &first, &second, der);
            return Err("SIG_WINDOWS_ONLY".into());
        };
        result["coversCurrent"] = json!(end == length);
        result["signedBytes"] = json!(end);
        result["fileBytes"] = json!(length);
        result["onlineChecked"] = json!(false);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
