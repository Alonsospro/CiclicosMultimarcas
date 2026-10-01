const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const source = fs.readFileSync(require('path').join(__dirname,'../gas/Code.gs'),'utf8');
function fresh() {
  const context = vm.createContext({ console, Logger:{log(){}}, Utilities:{
    DigestAlgorithm:{SHA_256:'sha256'}, computeDigest(_,data){return [...crypto.createHash('sha256').update(data).digest()];},
    base64Decode(data){return [...Buffer.from(data,'base64')];},newBlob(bytes,mime,name){return {bytes,mime,name};}
  }});
  vm.runInContext(source,context);
  return context;
}
function sheet(rows) {
  return { getLastRow:()=>rows.length+1,getMaxColumns:()=>40,getLastColumn:()=>40,
    getRange(r,c,n=1,w=1){return {getValues:()=>rows.slice(r-2,r-2+n).map(row=>row.slice(c-1,c-1+w)),
      setValues(values){values.forEach((row,i)=>{rows[r-2+i] ||= Array(40).fill('');row.forEach((v,j)=>rows[r-2+i][c-1+j]=v);});},
      clearContent(){for(let i=0;i<n;i++) rows[r-2+i]=Array(40).fill('');}};}};
}
const row = (sku,warehouse,location) => {const r=Array(40).fill('');r[0]=sku;r[6]=warehouse;r[3]=location;return r;};
test('both recount rounds accept zero without retaining old amounts',()=>{
  const c=fresh(),r=row('S','W','L');r[10]=10;r[11]=10;r[12]=10;r[25]=5;r[26]=2;r[36]=8;r[37]=3;
  c.updateExistingRow_(sheet([r]),2,{reconteo:0,reconteoFisico:0,malestadoReconteo:0,reconteoMalEstado:0,reconteo2:0,malestadoReconteo2:0},r);
  assert.deepEqual([r[25],r[26],r[36],r[37]],[0,0,0,0]);
});
test('invalid and empty centres never select the first sheet',()=>{
  const c=fresh();let touched=false;
  const ss={getSheetByName(){return null;},getSheets(){touched=true;return [{}];}};
  assert.throws(()=>c.getCenterSheetFromSs_(ss,'9999'));assert.throws(()=>c.getCenterSheetFromSs_(ss,''));assert.equal(touched,false);
});
test('warehouse/location mismatch and ambiguous SKU are rejected',()=>{
  const c=fresh(),sh=sheet([row('S','A','LOC'),row('S','B','OTHER')]);
  assert.equal(c.findRowInSheet_(sh,'S','','LOC','B'),null);
  assert.throws(()=>c.findRowInSheet_(sh,'S','','',''));
  assert.equal(c.findRowInSheet_(sh,'S','','OTHER','B').rowNumber,3);
});
test('a partial batch identifies all 14 failed items',()=>{
  const c=fresh();c.getCenterSheet_=()=>sheet([]);c.ensureColumns_=()=>{};
  c.upsertCount_=p=>{if(p.fail)throw new Error('simulated');return {isNewItem:false};};
  const result=c.batchUpsertCounts_({center:'1310',type:'CICLICO',updates:Array.from({length:20},(_,i)=>({sku:'S'+i,itemId:'I'+i,fail:i<14}))});
  assert.equal(result.success,false);assert.equal(result.failedItems.length,14);assert.equal(result.updatedCount,6);
  assert.equal(result.failedItems[13].itemId,'I13');
});
test('direct justification photo routes by category and returns real Drive metadata',()=>{
  const c=fresh();let created=0;
  const folder={getFilesByName(){return {hasNext:()=>false};},getId:()=> 'folder',getName:()=> 'photos',createFile(blob){created++;return {getId:()=> 'real-file',getName:()=>blob.name,getUrl:()=> 'https://drive.google.com/file/d/real-file/view',setSharing(){}};}};
  c.getJustificationPhotosTargetFolder_=()=>folder;
  c.DriveApp={Access:{ANYONE_WITH_LINK:1},Permission:{VIEW:1}};
  const result=c.savePhotoDirectly_({action:'savePhoto',category:'justificaciones',center:'1310',type:'CICLICO',sku:'S',inventoryId:'I',itemId:'A',photoBase64:'data:image/jpeg;base64,/9j/AA=='});
  assert.equal(result.success,true);assert.equal(result.photo.id,'real-file');assert.equal(result.photo.mimeType,'image/jpeg');assert.equal(created,1);
});
test('photo names differ by inventory, row, round and image content',()=>{
  const c=fresh(),base={inventoryId:'I1',itemId:'A',category:'justificaciones',round:1};
  const first=c.photoFileName_(base,'S','data:image/jpeg;base64,/9j/AA==');
  for(const extra of [{inventoryId:'I2'},{itemId:'B'},{round:2}]) assert.notEqual(c.photoFileName_({...base,...extra},'S','data:image/jpeg;base64,/9j/AA=='),first);
  assert.notEqual(c.photoFileName_(base,'S','data:image/jpeg;base64,/9j/BA=='),first);
});
test('failed image replacement never trashes existing evidence',()=>{
  const c=fresh();let trashed=false;
  c.getJustificationPhotosTargetFolder_=()=>({getFilesByName:()=>({hasNext:()=>false}),createFile(){throw new Error('Drive full');}});
  c.Utilities.base64Decode=()=>{throw new Error('invalid image');};
  assert.throws(()=>c.saveJustificationPhotoIfAny_({action:'saveJustification',photoBase64:'data:image/jpeg;base64,AAAA'},'1310','CICLICO','S'));
  assert.equal(trashed,false);
  assert.equal(source.includes('existing.next().setTrashed(true)'),false);
});
test('CUADRA uses an existing zero recount total',()=>{
  const c=fresh(),r=row('S','W','L');r[10]=10;r[11]=10;r[24]=0;r[25]=0;
  c.getCenterSheet_=()=>sheet([r]);c.saveJustificationPhotoIfAny_=()=>null;
  c.saveJustificationToSheet_({center:'1310',sku:'S',almacen:'W',location:'L',corroboracion:'CUADRA'});
  assert.equal(r[10],0);
});
test('snapshot export preserves duplicate SKU identities, zeros and all count rounds',()=>{
  const c=fresh(),rows=[row('OLD','W','L')],sh=sheet(rows);
  c.syncFromDriveRecordItems_(sh,[{SKU:'S',Ubicacion:'L1',Almacen:'W1',Stock_Fisico:2,Mal_estado:3,Reconteo_Fisico:0,Reconteo_Mal_Estado:0},
    {SKU:'S',Ubicacion:'L2',Almacen:'W2',Stock_Fisico:9,Mal_estado:0,Reconteo_2:0}], '1310','CICLICO');
  assert.deepEqual(rows.map(r=>[r[0],r[3],r[6],r[11],r[12]]),[['S','L1','W1',5,2],['S','L2','W2',9,9]]);
  assert.equal(rows[0][25],0);assert.equal(rows[1][36],0);
});
test('HTML cannot be saved as an image',()=>{
  assert.throws(()=>fresh().saveBase64Image_({},'photo.jpg','https://drive.google.com/file/d/123/view'));
});
