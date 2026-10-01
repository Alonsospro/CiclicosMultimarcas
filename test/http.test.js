const { test, before, after } = require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const FakeFirestore=require('./helpers/fakeFirestore');
const config=require('../src/config');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nibol-http-tests-'));
config.baseDataDir=temp;config.referencePhotosDir=path.join(temp,'references');
const realFetch=global.fetch;const fake=new FakeFirestore();global.fetch=fake.fetch;
// HTTP boundary uses an isolated router with the original authentication middleware.
const express=require('express');const jwt=require('jsonwebtoken');
const app=express();app.use(express.json());app.use('/api/inventories',require('../src/routes/inventoryRoutes'));
app.use('/api/photos',require('../src/routes/photoRoutes'));
app.use('/api/justifications',require('../src/routes/justificationRoutes'));
let server,base;
const token=jwt.sign({username:'tester',displayName:'Test',role:'ADMIN',isSuperadmin:true,center:'GLOBAL'},config.jwtSecret);
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});});
test('HTTP count success waits for persistence and quota returns 503',async()=>{
  fake.seed('inventories/I.json',{id:'I',name:'Test',type:'CICLICO',center:'1310',status:'EN_PROGRESO',items:[{id:'A',SKU:'S',Stock_Fisico:null,Stock_Sistema:10,Almacen:'W',Ubicacion:'L'}]});
  const options={method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({itemId:'A',sku:'S',stockFisico:3,operationId:'http1',expectedItemVersion:0})};
  fake.failCommit='RESOURCE_EXHAUSTED';
  let response=await realFetch(base+'/api/inventories/I/count',options);assert.equal(response.status,503);assert.equal((await response.json()).success,false);
  fake.failCommit=null;response=await realFetch(base+'/api/inventories/I/count',options);assert.equal(response.status,200);assert.equal((await response.json()).success,true);
  assert.equal(fake.value('inventories/I.json').items[0].Stock_Fisico,3);
});
test('failed Drive photo upload never returns HTTP success or a folder URL',async()=>{
  fake.gasFailure=true;
  const form=new FormData();form.append('photo',new Blob([Buffer.from([255,216,255,0])],{type:'image/jpeg'}),'photo.jpg');
  form.append('category','justificaciones');form.append('center','1310');form.append('inventoryId','I');form.append('itemId','A');form.append('sku','S');
  const response=await realFetch(base+'/api/photos/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});
  assert.equal(response.status,500);const body=await response.json();assert.equal(body.success,false);assert.equal(body.photo,undefined);
});
test('justification listing keeps the array contract used by the existing screen',async()=>{
  const response=await realFetch(base+'/api/justifications',{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(Array.isArray(body.tasks),true);assert.equal(body.tasks[0].inventoryId,'I');
});
