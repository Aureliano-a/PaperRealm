#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod translate;
mod ocr;
mod signature;
mod form_submit;
mod pdf_import;
use rusqlite::{params,Connection};
use std::sync::{Mutex,Arc};
use tauri::{Manager,State};
struct Database(Arc<Mutex<Connection>>);
#[tauri::command]
fn db_keys(db:State<Database>)->Result<Vec<String>,String>{
 let conn=db.0.lock().map_err(|e|e.to_string())?;
 let mut statement=conn.prepare("SELECT key FROM records ORDER BY key").map_err(|e|e.to_string())?;
 let rows=statement.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
 rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}
#[tauri::command]
fn db_get(db:State<Database>, key:String)->Result<Option<String>,String>{
 use rusqlite::OptionalExtension;
 db.0.lock().map_err(|e|e.to_string())?.query_row("SELECT value FROM records WHERE key=?1",[key],|r|r.get(0)).optional().map_err(|e|e.to_string())
}
#[tauri::command]
fn db_put(db:State<Database>,key:String,value:String)->Result<(),String>{
 db.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO records(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map(|_|()).map_err(|e|e.to_string())
}
fn source_blob<'a>(conn:&'a Connection,id:&str)->Result<rusqlite::blob::Blob<'a>,String>{
 let row:i64=conn.query_row("SELECT rowid FROM records WHERE key=?1",[format!("source:{}",id)],|r|r.get(0)).map_err(|e|e.to_string())?;
 conn.blob_open(rusqlite::DatabaseName::Main,"records","value",row,true).map_err(|e|e.to_string())
}
#[tauri::command]
fn db_source_info(db:State<Database>,id:String)->Result<serde_json::Value,String>{
 let conn=db.0.lock().map_err(|e|e.to_string())?;let blob=source_blob(&conn,&id)?;let length=blob.len();
 if length<2{return Err("Invalid local source".into());}let mut first=[0u8;1];blob.read_at_exact(&mut first,0).map_err(|e|e.to_string())?;
 if first[0]==b'"'{return Ok(serde_json::json!({"legacyLength":length-2}));}
 if length>1048576{return Err("Invalid source descriptor".into());}let mut bytes=vec![0u8;length];blob.read_at_exact(&mut bytes,0).map_err(|e|e.to_string())?;
 serde_json::from_slice(&bytes).map_err(|e|e.to_string())
}
#[tauri::command]
fn db_source_part(db:State<Database>,id:String,start:i64,length:i64)->Result<String,String>{
 if start<0||length<0||length>1048576{return Err("Invalid source range".into());}
 let conn=db.0.lock().map_err(|e|e.to_string())?;let blob=source_blob(&conn,&id)?;let mut first=[0u8;1];blob.read_at_exact(&mut first,0).map_err(|e|e.to_string())?;
 if first[0]!=b'"'||blob.len()<2{return Err("Source is not a legacy string".into());}
 let begin=(start as usize).checked_add(1).ok_or("Invalid source range")?;let end=begin.checked_add(length as usize).ok_or("Invalid source range")?;
 if end>blob.len()-1{return Err("Source range exceeds file".into());}
 let mut bytes=vec![0u8;length as usize];blob.read_at_exact(&mut bytes,begin).map_err(|e|e.to_string())?;String::from_utf8(bytes).map_err(|e|e.to_string())
}
#[tauri::command]
fn open_pdf_link(url:String)->Result<(),String>{
 let parsed=reqwest::Url::parse(&url).map_err(|_|"Invalid link")?;
 if !matches!(parsed.scheme(),"http"|"https")||parsed.host_str().is_none()||!parsed.username().is_empty()||parsed.password().is_some(){return Err("Unsupported link".into());}
 #[cfg(target_os="windows")]
 {use std::os::windows::process::CommandExt;std::process::Command::new("explorer.exe").arg(parsed.as_str()).creation_flags(0x08000000).spawn().map_err(|e|e.to_string())?;Ok(())}
 #[cfg(not(target_os="windows"))]
 {Err("Opening links is supported on Windows only".into())}
}
fn main(){tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app,_,_|{if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.set_focus();}})).plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_fs::init()).setup(|app|{
 let dir=std::env::var_os("PAPERREALM_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(app.path().app_data_dir()?); std::fs::create_dir_all(&dir)?;
 let conn=Connection::open(dir.join("paperrealm.sqlite3"))?;
 conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records(key TEXT PRIMARY KEY,value TEXT NOT NULL); DELETE FROM records WHERE key GLOB 'pdf-import:*';")?;
 app.manage(Database(Arc::new(Mutex::new(conn)))); Ok(())
 }).invoke_handler(tauri::generate_handler![db_get,db_put,db_keys,db_source_info,db_source_part,open_pdf_link,translate::translate_text,ocr::ocr_languages,ocr::ocr_image,signature::verify_pdf_signature,form_submit::submit_pdf_form,pdf_import::db_finish_pdf_import,pdf_import::db_discard_pdf_import]).run(tauri::generate_context!()).expect("PaperRealm startup failed");}
