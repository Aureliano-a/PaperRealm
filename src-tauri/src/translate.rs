use std::time::Duration;
use reqwest::{Client, redirect::Policy, Url};
use serde_json::{json, Value};

#[tauri::command]
pub async fn translate_text(base_url: String, api_key: String, model: String, target: String, text: String, sentences: Option<Vec<String>>) -> Result<String, String> {
    if api_key.trim().is_empty() { return Err("请填写 DeepSeek API 密钥。".into()); }
    if text.trim().is_empty() || text.chars().count() > 6000 { return Err("请输入 1 至 6000 个字符。".into()); }
    if model.len() > 100 || target.len() > 40 || api_key.len() > 512 { return Err("设置内容过长。".into()); }
    let mut url = Url::parse(base_url.trim()).map_err(|_| "API 地址格式不正确。")?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("API 地址必须是 HTTPS 地址，且不能包含账号、查询参数或片段。".into());
    }
    let path = url.path().trim_end_matches('/').to_string();
    if !path.ends_with("/chat/completions") { url.set_path(&format!("{path}/chat/completions")); }
    let client = Client::builder().timeout(Duration::from_secs(120)).redirect(Policy::none()).build().map_err(|_| "网络初始化失败。")?;
    let mut payload = json!({
      "model": model.trim(), "stream": false, "thinking": {"type":"disabled"},
      "messages": [ {"role":"system", "content": format!("你是一名专业翻译。将用户提供的文本翻译成{}，保留段落、人物名和语气。只输出译文，不要解释。", target.trim())},
        {"role":"user", "content":text} ]
    });
    if let Some(parts) = &sentences {
        if parts.is_empty() || parts.len() > 200 || parts.iter().any(|p| p.trim().is_empty()) || parts.iter().map(|p| p.chars().count()).sum::<usize>() > 6000 { return Err("当前页无法分句翻译，请缩小阅读区域后重试。".into()); }
        let items: Vec<Value> = parts.iter().enumerate().map(|(id, source)| json!({"id":id,"source":source})).collect();
        payload["response_format"] = json!({"type":"json_object"});
        payload["max_tokens"] = json!(16000);
        payload["messages"] = json!([
          {"role":"system", "content":format!("你是专业翻译。将每个编号的原文独立翻译为{}。结合相邻句子上下文保持人名、语气一致；必须逐条一对一，禁止合并、遗漏或改变顺序。只输出 JSON：{{\"items\":[{{\"id\":0,\"translation\":\"译文\"}}]}}，每项 id 保持输入编号，不要添加说明。",target.trim())},
          {"role":"user", "content":serde_json::to_string(&items).map_err(|_| "无法准备翻译内容。")?}
        ]);
    }
    let response = client.post(url).bearer_auth(api_key.trim()).json(&payload).send().await.map_err(|e| if e.is_timeout() { "请求超时，请稍后重试。" } else { "无法连接翻译服务，请检查网络与 API 地址。" })?;
    let status = response.status();
    if !status.is_success() { return Err(format!("翻译服务返回 HTTP {}。请检查密钥、账户余额、模型和 API 地址。", status.as_u16())); }
    let body: Value = response.json().await.map_err(|_| "服务返回的数据无法解析。")?;
    if body.pointer("/choices/0/finish_reason").and_then(Value::as_str) == Some("length") { return Err("译文被截断，请缩小阅读区域后重试。".into()); }
    let content = body.pointer("/choices/0/message/content").and_then(Value::as_str).filter(|s| !s.trim().is_empty()).ok_or("服务没有返回译文。")?;
    if let Some(parts) = sentences {
        let parsed: Value = serde_json::from_str(content).map_err(|_| "逐句译文格式不正确，请重试。")?;
        let items = parsed.get("items").and_then(Value::as_array).ok_or("逐句译文格式不正确，请重试。")?;
        if items.len() != parts.len() { return Err("逐句译文数量不一致，请重试。".into()); }
        let mut out = Vec::with_capacity(items.len());
        for (index,item) in items.iter().enumerate() {
            if item.get("id").and_then(Value::as_u64) != Some(index as u64) { return Err("逐句译文顺序不一致，请重试。".into()); }
            let value = item.get("translation").and_then(Value::as_str).filter(|x| !x.trim().is_empty()).ok_or("逐句译文不完整，请重试。")?;
            out.push(value.to_string());
        }
        return serde_json::to_string(&out).map_err(|_| "无法保存逐句译文。".into());
    }
    Ok(content.to_owned())
}
