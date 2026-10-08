const {randomUUID}=require('crypto');
module.exports=async function request(url,payload,options={}) {
  if(!process.env.APPS_SCRIPT_TOKEN)throw new Error('Configure APPS_SCRIPT_TOKEN para conectar con Apps Script.');
  const body=JSON.stringify({...payload,operationId:payload.operationId||randomUUID(),apiToken:process.env.APPS_SCRIPT_TOKEN});
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(45000)});
      let result;
      try{result=JSON.parse(await response.text());}catch(_){throw new Error('Respuesta no JSON: Google no confirmó la operación.');}
      if(!response.ok||result.success!==true){
        const e=new Error(result.error||result.message||'Google no confirmó la operación.');
        e.result=result;e.retryable=response.status>=500||result.retryable===true;throw e;
      }
      if(options.file&&!result.fileId)throw new Error('Google no devolvió el identificador del archivo final.');
      if(options.photo&&!result.photo?.id)throw new Error('Google no confirmó la foto.');
      return result;
    }catch(e){
      if((e.result&&!e.retryable)||attempt===2)throw e;
      await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
  }
};