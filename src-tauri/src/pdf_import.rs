use crate::Database;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use tauri::State;

const CHUNK: usize = 384 * 1024;

fn prefix(token: &str) -> Result<String, String> {
    if token.len() != 32 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid PDF import identifier".into());
    }
    Ok(format!("pdf-import:{token}:"))
}

fn discard(conn: &Connection, prefix: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM records WHERE key GLOB ?1",
        [format!("{prefix}*")],
    )
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn db_discard_pdf_import(db: State<Database>, token: String) -> Result<(), String> {
    let prefix = prefix(&token)?;
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    discard(&conn, &prefix)
}

#[tauri::command]
pub async fn db_finish_pdf_import(
    db: State<'_, Database>,
    token: String,
    length: usize,
) -> Result<String, String> {
    let prefix = prefix(&token)?;
    if length < 5 {
        return Err("Invalid PDF length".into());
    }
    let db = db.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = db.lock().map_err(|error| error.to_string())?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        let parts = length.div_ceil(CHUNK);
        let mut hash = Sha256::new();
        for index in 0..parts {
            let raw: Option<String> = tx
                .query_row(
                    "SELECT value FROM records WHERE key = ?1",
                    [format!("{prefix}{index}")],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            let encoded: String =
                serde_json::from_str(raw.as_deref().ok_or("Missing PDF import chunk")?)
                    .map_err(|error| error.to_string())?;
            let expected = CHUNK.min(length - index * CHUNK);
            if encoded.len() != expected.div_ceil(3) * 4 {
                return Err("Invalid PDF import chunk length".into());
            }
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|error| error.to_string())?;
            if bytes.len() != expected || (index == 0 && !bytes.starts_with(b"%PDF-")) {
                return Err("Invalid PDF import chunk".into());
            }
            hash.update(bytes);
        }
        let id = format!("{:x}", hash.finalize());
        let count: usize = tx
            .query_row(
                "SELECT COUNT(*) FROM records WHERE key GLOB ?1",
                [format!("{prefix}*")],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if count != parts {
            return Err("Unexpected PDF import chunks".into());
        }
        let source_key = format!("source:{id}");
        // SQLite moves the verified chunks under the content hash in one transaction.
        {
            let mut move_chunk = tx
                .prepare("UPDATE OR REPLACE records SET key = ?1 WHERE key = ?2")
                .map_err(|error| error.to_string())?;
            for index in 0..parts {
                move_chunk
                    .execute(params![
                        format!("source-part:{id}:{index}"),
                        format!("{prefix}{index}")
                    ])
                    .map_err(|error| error.to_string())?;
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO records(key,value) VALUES (?1,?2)",
            params![
                source_key,
                serde_json::json!({ "version": 1, "parts": parts, "length": length }).to_string()
            ],
        )
        .map_err(|error| error.to_string())?;
        discard(&tx, &prefix)?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(id)
    })
    .await
    .map_err(|error| error.to_string())?
}
