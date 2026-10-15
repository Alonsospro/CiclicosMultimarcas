const {randomUUID}=require('crypto');
function tokenForType(type) {
  const cleanType=String(type||'CICLICO').trim().toUpperCase();
  const tokenNames={
    CICLICO:'CICLICOS_APPS_SCRIPT_TOKEN',
    CICLICOS:'CICLICOS_APPS_SCRIPT_TOKEN',
    BARRIDO:'BARRIDO_APPS_SCRIPT_TOKEN',
    MENSUAL:'MENSUALES_APPS_SCRIPT_TOKEN',
    MENSUALES:'MENSUALES_APPS_SCRIPT_TOKEN',
    SEMANAL:'SEMANALES_APPS_SCRIPT_TOKEN',
    SEMANALES:'SEMANALES_APPS_SCRIPT_TOKEN'
  };
  const tokenName=tokenNames[cleanType]||tokenNames.CICLICO;
  const token=process.env[tokenName]||process.env.APPS_SCRIPT_TOKEN;
  if(!token)throw new Error(`Configure ${tokenName} (o APPS_SCRIPT_TOKEN como respaldo) para conectar con Apps Script.`);
  return token;
}
module.exports=async function request(url,payload,options={}) {
  const body=JSON.stringify({...payload,operationId:payload.operationId||randomUUID(),apiToken:tokenForType(payload.type)});
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
