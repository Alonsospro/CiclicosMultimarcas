const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const contract = require('../src/services/inventoryContract');
const model = require('../src/services/inventorySheetModel');

const item = {SKU:'VO_21834210', Descripcion:'FILTRO', Almacen:'RVO6', Ubicacion:'L1',
  Stock_Sistema:1, Costo_Unitario:875.45, Stock_Buen_Estado:2, Stock_Total:2, Mal_estado:0,
  Fecha_Ultimo_Conteo:'2026-10-20T12:00:00.000Z', Responsable:'Contador'};

function fixture(weekly = false, corruptWrite = false) {
  const columns = weekly ? contract.weeklyColumns : contract.columns;
  const books = new Map(), files = new Map(), calls = [];
  let serial = 0;
  const folder = {getName:()=>'Archivos Finales',getId:()=>'ROOT',getFiles:()=>iterator([...files.values()].filter(f=>!f.trashed)),
    getFoldersByName:()=>iterator([folder]),
    createFile(name, text) {const f=file('evidence_'+(++serial), name);f.text=text;calls.push('evidence');return f;}};
  function iterator(values) {let i=0;return {hasNext:()=>i<values.length,next:()=>values[i++]};}
  function file(id, name) {
    const f={id,name,description:'',getId:()=>id,getName:()=>f.name,setName:value=>{f.name=value;},getUrl:()=>`https://docs.google.com/spreadsheets/d/${id}/edit`,
      getDescription:()=>f.description,setDescription:value=>{f.description=value;},moveTo:()=>calls.push('move'),
      getParents:()=>iterator([folder]),getLastUpdated:()=>new Date(),getDateCreated:()=>new Date(),setTrashed:value=>{f.trashed=value;}};
    files.set(id,f);return f;
  }
  function sheet(name, grid, formats, id, destination = false) {
    const sh={name,grid:grid.map(row=>row.slice()),formats:formats.map(row=>row.slice()),id,
      getName:()=>sh.name,setName:value=>{sh.name=value;return sh;},getSheetId:()=>id,
      getMaxRows:()=>100,getMaxColumns:()=>columns.length,getLastRow:()=>{
        let n=sh.grid.length;while(n && !sh.grid[n-1].some(v=>v!==''&&v!==null&&v!==undefined))n--;return n;
      },showSheet:()=>sh,deleteColumns(){},
      copyTo(book) {calls.push('copy-center');const copied=sheet(name,sh.grid,sh.formats,900,true);book.sheets.push(copied);return copied;},
      getRange(row,col,height=1,width=1) {return {
        getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>sh.grid[row-1+i]?.[col-1+j]??'')),
        getDisplayValues(){return this.getValues().map(r=>r.map(String));},
        getNumberFormats:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>sh.formats[row-1+i]?.[col-1+j]??'General')),
        setValues(values) {values.forEach((r,i)=>{sh.grid[row-1+i]||=[];r.forEach((v,j)=>{sh.grid[row-1+i][col-1+j]=v;});});
          if(destination&&corruptWrite&&row===2)sh.grid[1][9]=999;},
        setNumberFormats(values){values.forEach((r,i)=>{sh.formats[row-1+i]||=[];r.forEach((v,j)=>{sh.formats[row-1+i][col-1+j]=v;});});},
        clearContent(){for(let i=0;i<height;i++)for(let j=0;j<width;j++)if(sh.grid[row-1+i])sh.grid[row-1+i][col-1+j]='';}
      };}
    };return sh;
  }
  const context=vm.createContext({Date,console,Session:{getScriptTimeZone:()=>'America/La_Paz'},
    MimeType:{PLAIN_TEXT:'text/plain'},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},formatDate:()=>'20261020_120000',
      computeDigest:(_algorithm,value)=>[...createHash('sha256').update(value).digest()]},
    SpreadsheetApp:{create(name){calls.push('create');const id='generated_'+(++serial);
      const book={sheets:[sheet('Sheet1',[['']], [['General']],1)],getId:()=>id,
        getSheets:()=>book.sheets.slice(),getSheetByName:name=>book.sheets.find(s=>s.name===name),
        deleteSheet:s=>{book.sheets=book.sheets.filter(other=>other!==s);},
        setSpreadsheetLocale:v=>{book.locale=v;},setSpreadsheetTimeZone:v=>{book.timeZone=v;},getSpreadsheetTimeZone:()=>book.timeZone};
      books.set(id,book);file(id,name);return book;},openById:id=>books.get(id),flush(){}},
    DriveApp:{getFileById:id=>files.get(id)}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../integrations/apps-script/',weekly?'InventoryWebhookSemanales.gs':'InventoryWebhook.gs'),'utf8'),context);
  const headers=weekly?contract.weeklyHeaders:vm.runInContext('DEFAULT_HEADERS',context);
  const sourceItem=weekly?{...item,Schema_Version:contract.weeklyVersion}:item;
  const formats=columns.map(k=>k.startsWith('Costo_')?'[$Bs]#,##0.00':k.startsWith('Fecha_')?'d/M/yyyy H:mm:ss':k.startsWith('Stock_')?'#,##0':'@');
  const source=sheet('5100',[Array.from(headers),columns.map(k=>sourceItem[k]??'')],[formats,formats],123);
  const sourceBook={getSheetByName:n=>n==='5100'?source:null,getSpreadsheetLocale:()=>'es_BO',getSpreadsheetTimeZone:()=>'America/La_Paz'};
  context.spreadsheet_=()=>sourceBook;context.getRootFolderForType_=()=>folder;context.getOrCreateFolder_=()=>folder;
  context.allowedRoots_=()=>['ROOT'];context.belongsToRoot_=()=>true;context.savePhotoIfAny_=()=>null;
  return {context,files,books,source,calls,sourceItem,folder};
}

for(const weekly of [false,true]) test(`${weekly?'weekly 43':'legacy 40'} closure copies just the center, keeps formats and round-trips its confirmed values`,()=>{
  const f=fixture(weekly),before=JSON.stringify(f.source.grid);
  const counted=contract.normalize({...f.sourceItem,Reconteo:1,Malestado_Reconteo:0,
    Stock_Total_Reconteo:1,Fecha_Reconteo:'2026-10-20T13:00:00.000Z'});
  const payload={type:weekly?'SEMANAL':'CICLICO',center:'5100',operationId:'CLOSE-1',
    ...(weekly?{schemaVersion:contract.weeklyVersion}:{}),
    driveRecord:{inventoryId:'INV-5100-1',items:[counted],justifications:[{sku:item.SKU,almacen:item.Almacen,round:2,justification:'Revisado'}]}};
  const result=f.context.createFinalFile_(payload),book=f.books.get(result.fileId),final=book.sheets[0];
  assert.equal(book.sheets.length,1);assert.equal(final.name,'5100');assert.equal(book.locale,'es_BO');
  assert.equal(final.formats[1][9],'[$Bs]#,##0.00');assert.equal(final.formats[1][10],'#,##0');
  assert.equal(final.formats[1][weekly?17:16],'d/M/yyyy H:mm:ss');
  assert.equal(final.grid[1][9],875.45);assert.equal(final.grid[1][weekly?12:11],2);
  assert.equal(JSON.stringify(f.source.grid),before);assert.equal(result.spreadsheetUrl.endsWith('#gid=900'),true);
  const evidence=JSON.parse(f.files.get(result.evidenceFileId).text);
  assert.equal(evidence.justifications[0].round,2);assert.equal(evidence.inventoryManifest.members.length,1);
  const read=f.context.readFinalInventory_({spreadsheetId:result.fileId,center:'5100',gid:900});
  const normalized=model.normalizeTable(Array.from(read.headers),Array.from(read.rows,r=>Array.from(r)),read.schemaVersion)[0];
  assert.equal(normalized.Stock_Total_Reconteo,1);assert.equal(normalized.Costo_Unitario,875.45);
  assert.equal(f.context.createFinalFile_(payload).fileId,result.fileId);
  assert.equal(f.calls.filter(c=>c==='create').length,1,'Retry must reuse the same Drive link');
  final.grid[1][9]=100;
  assert.throws(()=>f.context.readFinalInventory_({spreadsheetId:result.fileId,center:'5100'}),/manifiesto/);
});

test('a failed read-after-write never publishes a final file',()=>{
  const f=fixture(false,true);
  assert.throws(()=>f.context.createFinalFile_({type:'CICLICO',center:'5100',operationId:'bad',driveRecord:{items:[item]}}),/no conserva/);
  assert.equal([...f.files.values()].filter(file=>!file.trashed).length,0);
});

test('corrupt quantities, dates in numeric fields and negative costs fail before a copy is created',()=>{
  for(const bad of [{...item,Stock_Buen_Estado:1900},{...item,Costo_Unitario:-54541},{...item,Costo_Unitario:new Date()}]) {
    const f=fixture();
    assert.throws(()=>f.context.createFinalFile_({type:'CICLICO',center:'5100',driveRecord:{items:[bad]}}));
    assert.equal(f.calls.length,0);
  }
});

test('old multi-tab archives remain readable by their exact center and gid',()=>{
  const f=fixture(),book={getSheetByName:()=>null,getSheets:()=>[f.source],getSpreadsheetTimeZone:()=>'America/La_Paz'};
  f.books.set('old_file',book);
  const generated=f.context.createFinalFile_({type:'CICLICO',center:'5100',operationId:'test',driveRecord:{items:[item]}});
  const old={...f.files.get(generated.fileId),getDescription:()=>''};f.files.set('old_file',old);
  const read=f.context.readFinalInventory_({spreadsheetId:'old_file',center:'5100',gid:123});
  assert.equal(read.legacy,true);assert.equal(read.sheetName,'5100');
  assert.throws(()=>f.context.readFinalInventory_({spreadsheetId:'old_file',center:'5100',gid:999}),/no corresponde/);
});

test('Drive history discovers old center copies and ignores evidence JSON files',()=>{
  const f=fixture();
  const result=f.context.createFinalFile_({type:'CICLICO',center:'5100',operationId:'close',driveRecord:{items:[item]}});
  assert.equal(f.context.getHistory_('CICLICO','5100').length,1);
  f.files.get(result.fileId).description='Archivo final antiguo';
  const old=f.context.getHistory_('CICLICO','5100');
  assert.equal(old.length,1);assert.equal(old[0].fileId,result.fileId);assert.equal(old[0].legacy,true);
});

test('previous closures with a hidden manifest keep membership verification',()=>{
  const f=fixture();
  const generated=f.context.createFinalFile_({type:'CICLICO',center:'5100',operationId:'close',driveRecord:{items:[item]}});
  const manifest={...model.createManifest({id:'INV',center:'5100',type:'CICLICO',items:[item]}),gid:123};
  const meta={getLastRow:()=>2,getRange:row=>row===1?{getValue:()=>JSON.stringify(manifest)}:
    {getValues:()=>[[contract.member(item)]]}};
  const book={getSheetByName:name=>name==='__INVENTORY_MANIFEST'?meta:null,getSheets:()=>[f.source,meta],getSpreadsheetTimeZone:()=>'America/La_Paz'};
  f.books.set(generated.fileId,book);
  const read=f.context.readFinalInventory_({spreadsheetId:generated.fileId,center:'5100',gid:123});
  assert.equal(read.manifest.inventoryId,'INV');assert.equal(read.manifest.members.length,1);
  f.source.grid[1][6]='OTHER';
  assert.throws(()=>f.context.readFinalInventory_({spreadsheetId:generated.fileId,center:'5100'}),/manifiesto/);
});

for(const weekly of [false,true]) test(`${weekly?'weekly 43':'legacy 40'} reclosure rewrites the same final file and keeps its revisions`,()=>{
  const f=fixture(weekly);
  const row=(sku,qty)=>{const base={...f.sourceItem,SKU:sku,Stock_Buen_Estado:qty,Stock_Total:qty};return weekly?contract.normalize(base):base;};
  const close=(operationId,items,replaceFileId)=>f.context.createFinalFile_({type:weekly?'SEMANAL':'CICLICO',center:'5100',operationId,
    ...(weekly?{schemaVersion:contract.weeklyVersion}:{}),...(replaceFileId?{replaceFileId}:{}),
    driveRecord:{inventoryId:'INV-5100-1',items,justifications:[]}});
  const first=close('CLOSE-1',[row('A',2),row('B',1)]);
  const second=close('CLOSE-2',[row('A',3)],first.fileId);
  assert.equal(second.fileId,first.fileId,'Same Drive file and link');
  assert.equal(second.replaced,true);assert.equal(second.revision,2);
  assert.equal(f.calls.filter(c=>c==='create').length,1,'No new spreadsheet');
  assert.equal(f.files.get(first.evidenceFileId).trashed,true,'Previous evidence replaced');
  const read=f.context.readFinalInventory_({spreadsheetId:second.fileId,center:'5100'});
  assert.equal(read.rows.length,1,'Rows from the previous closure are removed');
  const revisions=JSON.parse(f.files.get(second.fileId).description).revisions;
  assert.deepEqual(revisions.map(r=>[r.operationId,r.itemCount]),[['CLOSE-1',2],['CLOSE-2',1]]);
  assert.equal(close('CLOSE-2',[row('A',3)],first.fileId).revision,2,'A retry returns the same revision');
  // A file of another inventory is never overwritten.
  const other=f.context.createFinalFile_({type:weekly?'SEMANAL':'CICLICO',center:'5100',operationId:'OTHER',
    ...(weekly?{schemaVersion:contract.weeklyVersion}:{}),replaceFileId:first.fileId,
    driveRecord:{inventoryId:'INV-5100-2',items:[row('Z',1)],justifications:[]}});
  assert.notEqual(other.fileId,first.fileId);assert.equal(other.replaced,false);
});

test('a failed reclosure restores the previous final file instead of trashing it',()=>{
  const f=fixture();
  const first=f.context.createFinalFile_({type:'CICLICO',center:'5100',operationId:'CLOSE-1',driveRecord:{inventoryId:'INV-5100-1',items:[item]}});
  const book=f.books.get(first.fileId),before=JSON.stringify(book.sheets[0].grid),description=f.files.get(first.fileId).description;
  const sheet=book.sheets[0],setRange=sheet.getRange;
  sheet.getRange=(...args)=>{const range=setRange(...args),set=range.setValues;
    range.setValues=values=>{set(values);if(values[0]?.[0]==='CHANGED')sheet.grid[1][9]=999;};return range;};
  assert.throws(()=>f.context.createFinalFile_({type:'CICLICO',center:'5100',operationId:'CLOSE-2',replaceFileId:first.fileId,
    driveRecord:{inventoryId:'INV-5100-1',items:[{...item,SKU:'CHANGED'}]}}),/no conserva/);
  assert.equal(f.files.get(first.fileId).trashed,undefined);
  assert.equal(JSON.stringify(sheet.grid),before);
  assert.equal(f.files.get(first.fileId).description,description);
});
