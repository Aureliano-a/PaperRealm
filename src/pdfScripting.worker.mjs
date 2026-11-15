// Runs PDF.js QuickJS in a disposable Worker. Document JS never runs in the host realm.
import {QuickJSSandbox} from './pdf.sandbox.mjs';
const reply=self.postMessage.bind(self);
self.onmessage=async event=>{
  const input=event.data,updates=[],notices=[];let failed='';
  const capture=value=>{if(!value||typeof value!=='object')return;if(updates.length>=10000)throw Error('SCRIPT_OUTPUT_LIMIT');if(value.command==='error')failed=String(value.value||'SCRIPT_ERROR').slice(0,1500);updates.push(value);};
  const facade={URL,CustomEvent:class extends Event{constructor(name,options){super(name);this.detail=options.detail;}},dispatchEvent:event=>capture(event.detail),setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},alert:text=>notices.push(String(text).slice(0,1500)),confirm:text=>{notices.push(String(text).slice(0,1500));return false;},prompt:text=>{notices.push(String(text).slice(0,1500));return null;},console:{log:()=>{},error:value=>{failed=String(value).slice(0,1500);}}};
  self.window=facade;
  let sandbox;
  try{
    sandbox=await QuickJSSandbox();
    const bridge='for(const [name,value] of '+JSON.stringify(input.values)+'){const field=this.getField(name);if(field)field.value=value;}';
    sandbox.create({objects:input.objects,calculationOrder:input.calculationOrder,appInfo:{platform:'Win32',language:input.language},docInfo:{numPages:input.pages,filename:input.filename,actions:{...input.actions,PaperRealmValues:['if(event&&event.name==="PaperRealmValues"){'+bridge+'}'],PaperRealmCalculate:['if(event&&event.name==="PaperRealmCalculate")this.calculateNow();']}}});
    sandbox.dispatchEvent({id:'doc',name:'Open'});
    sandbox.dispatchEvent({id:'doc',name:'PaperRealmValues'});
    updates.length=0;
    const initError=failed;failed='';notices.length=0;
    if(input.change){const change=input.change;
      if(change.action){sandbox.dispatchEvent({id:change.id,name:'MouseDown',value:change.value});sandbox.dispatchEvent({id:change.id,name:'MouseUp',value:change.value});}
      sandbox.dispatchEvent({id:change.id,name:change.button||change.action?'Action':'Keystroke',value:change.value,willCommit:true,commitKey:1,change:'',selStart:-1,selEnd:-1});
    }else sandbox.dispatchEvent({id:'doc',name:'PaperRealmCalculate'});
    const rejected=updates.some(item=>item.id===input.change?.id&&Array.isArray(item.selRange)&&(item.focus||item.value===''&&item.formattedValue===null));
    if(failed||rejected)throw Error(failed||notices.join('\n')||'SCRIPT_VALIDATION');
    if(initError)notices.push('SCRIPT_INIT: '+initError);
    const result={ok:true,updates,notices};if(JSON.stringify(result).length>5*1024*1024)throw Error('SCRIPT_OUTPUT_LIMIT');reply(result);
  }catch(error){reply({ok:false,error:String(error?.message||error).slice(0,2000),notices});}
  finally{sandbox?.nukeSandbox();}
};
