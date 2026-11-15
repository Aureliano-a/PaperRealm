use reqwest::{redirect::Policy, Client, Url};
use serde_json::{json, Value};
use std::time::Duration;
#[tauri::command]
pub async fn submit_pdf_form(url: String, body: String, format: String) -> Result<Value, String> {
    if body.len() > 1024 * 1024 {
        return Err("FORM_SUBMIT_LIMIT".into());
    }
    let parsed = Url::parse(url.trim()).map_err(|_| "FORM_SUBMIT_URL")?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err("FORM_SUBMIT_URL".into());
    }
    let mime = match format.as_str() {
        "json" => "application/json; charset=utf-8",
        "urlencoded" => "application/x-www-form-urlencoded; charset=utf-8",
        _ => return Err("FORM_SUBMIT_FORMAT".into()),
    };
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .post(parsed)
        .header("Content-Type", mime)
        .body(body)
        .send()
        .await
        .map_err(|_| "FORM_SUBMIT_NETWORK")?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = response.chunk().await.map_err(|_| "FORM_SUBMIT_RESPONSE")? {
        let remaining = 65536usize.saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..remaining.min(chunk.len())]);
        if chunk.len() > remaining || bytes.len() == 65536 {
            truncated = true;
            break;
        }
    }
    Ok(json!({"status":status,"body":String::from_utf8_lossy(&bytes),"truncated":truncated}))
}
