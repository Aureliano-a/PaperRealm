use serde_json::{json,Value};
use std::sync::atomic::{AtomicBool,Ordering};
static OCR_BUSY:AtomicBool=AtomicBool::new(false);
struct OcrPermit;
impl Drop for OcrPermit{fn drop(&mut self){OCR_BUSY.store(false,Ordering::Release);}}
#[cfg(windows)]
use windows::{core::HSTRING,Globalization::Language,Media::Ocr::OcrEngine,Graphics::Imaging::{BitmapDecoder,SoftwareBitmap,BitmapPixelFormat},Storage::Streams::{DataWriter,InMemoryRandomAccessStream},Win32::System::WinRT::{RoInitialize,RoUninitialize,RO_INIT_MULTITHREADED}};
#[cfg(windows)]
struct Apartment;
#[cfg(windows)]
impl Apartment{fn new()->Result<Self,String>{unsafe{RoInitialize(RO_INIT_MULTITHREADED)}.map_err(|e|format!("OCR_INIT: {e}"))?;Ok(Self)}}
#[cfg(windows)]
impl Drop for Apartment{fn drop(&mut self){unsafe{RoUninitialize()};}}

#[tauri::command]
pub async fn ocr_languages()->Result<Value,String>{
 tauri::async_runtime::spawn_blocking(||{
  #[cfg(windows)]{
   let _apartment=Apartment::new()?;
   let list=OcrEngine::AvailableRecognizerLanguages().map_err(|e|e.to_string())?;let mut out=Vec::new();
   for i in 0..list.Size().map_err(|e|e.to_string())?{let lang=list.GetAt(i).map_err(|e|e.to_string())?;out.push(json!({"tag":lang.LanguageTag().map_err(|e|e.to_string())?.to_string(),"name":lang.DisplayName().map_err(|e|e.to_string())?.to_string()}));}
   Ok(json!(out))
  }
  #[cfg(not(windows))]{Err("OCR_WINDOWS_ONLY".to_string())}
 }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn ocr_image(image:String,language:String)->Result<Value,String>{
 if image.len()>17*1024*1024||language.len()>64{return Err("OCR_IMAGE_LIMIT".into());}
 if OCR_BUSY.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Err("OCR_BUSY".into());}let permit=OcrPermit;
 tauri::async_runtime::spawn_blocking(move||{
  let _permit=permit;
  #[cfg(windows)]{
   use base64::Engine;
   let _apartment=Apartment::new()?;
   let bytes=base64::engine::general_purpose::STANDARD.decode(image).map_err(|_|"OCR_IMAGE_INVALID")?;
   if bytes.len()>12*1024*1024||!bytes.starts_with(&[137,80,78,71,13,10,26,10]){return Err("OCR_IMAGE_INVALID".into());}
   let process=||->windows::core::Result<Value>{
    let engine=if language.trim().is_empty(){OcrEngine::TryCreateFromUserProfileLanguages()?}else{OcrEngine::TryCreateFromLanguage(&Language::CreateLanguage(&HSTRING::from(language))?)?};
    let stream=InMemoryRandomAccessStream::new()?;let writer=DataWriter::new()?;writer.WriteBytes(&bytes)?;let buffer=writer.DetachBuffer()?;stream.WriteAsync(&buffer)?.join()?;stream.Seek(0)?;
    let decoder=BitmapDecoder::CreateAsync(&stream)?.join()?;let width=decoder.PixelWidth()?;let height=decoder.PixelHeight()?;let max=OcrEngine::MaxImageDimension()?;
    if width>max||height>max||(width as u64)*(height as u64)>4_000_000{return Err(windows::core::Error::new(windows::core::HRESULT(0x80070057u32 as i32),"OCR_IMAGE_LIMIT"));}
    let bitmap=decoder.GetSoftwareBitmapAsync()?.join()?;let converted=SoftwareBitmap::Convert(&bitmap,BitmapPixelFormat::Bgra8)?;
    let result=engine.RecognizeAsync(&converted)?.join()?;let lines=result.Lines()?;let mut words=Vec::new();
    for line_index in 0..lines.Size()?{let line=lines.GetAt(line_index)?;let list=line.Words()?;for word_index in 0..list.Size()?{let word=list.GetAt(word_index)?;let rect=word.BoundingRect()?;words.push(json!({"text":word.Text()?.to_string(),"rect":[rect.X,rect.Y,rect.Width,rect.Height],"line":line_index}));if words.len()>30000{return Err(windows::core::Error::new(windows::core::HRESULT(0x80070057u32 as i32),"OCR_WORD_LIMIT"));}}}
    Ok(json!({"text":result.Text()?.to_string(),"words":words,"width":width,"height":height,"language":engine.RecognizerLanguage()?.LanguageTag()?.to_string()}))
   };
   process().map_err(|e|format!("OCR_FAILED: {e}"))
  }
  #[cfg(not(windows))]{let _=(image,language);Err("OCR_WINDOWS_ONLY".into())}
 }).await.map_err(|e|e.to_string())?
}
