/**
 * Google Apps Script - Webhook API para Inventarios & Barrido
 * 
 * Estructura de Columnas (40 Columnas - A a AN):
 * A (1): SKU
 * B (2): Codigo_Barras
 * C (3): Descripcion
 * D (4): Ubicación (UBICACIÓN ORIGINAL)
 * E (5): Ubicación 1 (UBICACIÓN EXTRA 1)
 * F (6): Ubicación 2 (UBICACIÓN EXTRA 2)
 * G (7): Almacen (ALMCEN)
 * H (8): Clasificacion_ABC (ABC)
 * I (9): Unidad
 * J (10): Costo_Unitario (COSTO)
 * K (11): Stock_Sistema (STOCK DE SISTEMA)
 * L (12): STOCK TOTAL (cantidad total de la suma items en buen estado y mal estado del primer conteo)
 * M (13): stock B/E (BUEN ESTADO DEL PRIMER CONTEO)
 * N (14): stock M/E (MAL ESTADO DEL PRIMER CONTEO)
 * O (15): Diferencia (RESULTADO DE DIFERENCIA ENTRE STOCK FISICO Y PRIMER CONTEO)
 * P (16): Costo_Diferencia (RESULTADO DE MULTIPLICACION DE DIFERENCIA POR EL COSTO UNITARIO)
 * Q (17): Fecha_Ultimo_Conteo (FECHA Y HORA DEL PRIMER CONTEO)
 * R (18): Responsable (EL QUE HAYA CONTADO/COMPLETADO EL PRIMER CONTEO)
 * S (19): FECHA PRIMERA JUSTIFICACION (FECHA Y HORA DE LA PRIMERA JUSTIFICACION)
 * T (20): Estado (ESTADO DE LA PRIMERA JUSTIFICACION (CUADRA - NO CUADRA))
 * U (21): Razón (TIPO DE JUSTIFICACION)
 * V (22): Comentario Justificacion (DETALLE DE JUSTIFICACION)
 * W (23): RESPONSABLE JUSTIFICACION (NOMBRE DEL RESPONSABLE QUE REVISA EL PRIMER CONTEO)
 * X (24): Fecha reconteo (FECHA Y HORA DEL PRIMER RECONTEO)
 * Y (25): stock total reconteo (cantidad total de la suma de items en buen estado y mal estado del reconteo)
 * Z (26): RECONTEO (buen estado del primer reconteo)
 * AA (27): MALESTADO RECONTEO (MAL ESTADO DEL PRIMER RECONTEO)
 * AB (28): Diferencia Final (DIFERENCIA ENTRE EL PRIMER RECONTEO Y EL STOCK DE SISTEMA)
 * AC (29): Costo Diferencia Final (RESULTADO DE MULTIPLICACION DE DIFERENCIA FINAL PRIMER RECONTEO POR EL COSTO UNITARIO)
 * AD (30): FECHA JUSTIFICACION 2 (FECHA Y HORA DE LA SEGUNDA JUSTIFICACION)
 * AE (31): ESTADO JUSTIFICACION 2 (ESTADO DE LA SEGUNDA JUSTIFICACION (CUADRA - NO CUADRA))
 * AF (32): RazónJUSTIFICACION 2 (TIPO DE JUSTIFICACION 2)
 * AG (33): Comentario JustificaciON 2 (DETALLE DE SEGUNDA JUSTIFICACION)
 * AH (34): RESPONSABLE JUSTIFICACION 2 (NOMBRE DEL RESPONSABLE QUE REVISA EL PRIMER RECONTEO)
 * AI (35): Fecha reconteo 2 (FECHA Y HORA DEL SEGUNDO RECONTEO)
 * AJ (36): stock total reconteo 2 (cantidad total de la suma de items en buen estado y mal estado del segundo reconteo)
 * AK (37): RECONTEO 2 (CANTIDAD TOTAL DEL SEGUNDO RECONTEO)
 * AL (38): MALESTADO RECONTEO 2 (MAL ESTADO DEL SEGUNDO RECONTEO)
 * AM (39): Diferencia Final 2 (DIFERENCIA ENTRE EL SEGUNDO RECONTEO Y EL STOCK DE SISTEMA)
 * AN (40): Costo Diferencia Final 2 (RESULTADO DE MULTIPLICACION DE DIFERENCIA FINAL SEGUNDO RECONTEO POR EL COSTO UNITARIO)
 * 
 * Características:
 * - Soporta hasta 2 ubicaciones adicionales (Ubicación 1 en Col E, Ubicación 2 en Col F) dentro de la misma fila.
 * - Ya no genera filas duplicadas ni ingresos paralelos de conteo o mal estado por ubicación adicional.
 * - Al marcar como "CUADRA" en justificación, reescribe la Columna K (Stock_Sistema) con el Stock Físico/Total y pone Diferencia en 0.
 * - Sincronización bidireccional con la aplicación web.
 * - Guardado jerárquico de fotos en Google Drive (malestado y justificaciones).
 */

const CFG = {
  defaultCenterIfMissing: '1120',
  defaultSheetName: 'Inventario',
  headerRow: 1,
  dataStartRow: 2,
  // Configurar ROOT_CICLICO, ROOT_BARRIDO, ROOT_MENSUAL, etc. en propiedades.
  driveRoots: {}
};

const COL = {
  SKU: 1,                           // A (1)
  Codigo_Barras: 2,                 // B (2)
  Descripcion: 3,                   // C (3)
  Ubicacion: 4,                     // D (4)
  Ubicacion_1: 5,                   // E (5)
  Ubicacion_2: 6,                   // F (6)
  Almacen: 7,                       // G (7)
  Clasificacion_ABC: 8,             // H (8)
  Unidad: 9,                        // I (9)
  Costo_Unitario: 10,               // J (10)
  Stock_Sistema: 11,                // K (11)
  Stock_Total: 12,                  // L (12) STOCK TOTAL
  Stock_Fisico: 12,                 // L (12) alias para compatibilidad interna
  Stock_Buen_Estado: 13,            // M (13) stock B/E (BUEN ESTADO PRIMER CONTEO)
  Mal_estado: 14,                   // N (14) stock M/E (MAL ESTADO PRIMER CONTEO)
  Diferencia: 15,                   // O (15) Diferencia
  Costo_Diferencia: 16,             // P (16) Costo_Diferencia
  Fecha_Ultimo_Conteo: 17,          // Q (17) Fecha_Ultimo_Conteo
  Responsable: 18,                  // R (18) Responsable
  Fecha_Primera_Justificacion: 19,  // S (19) FECHA PRIMERA JUSTIFICACION
  Estado: 20,                       // T (20) Estado
  Razon: 21,                        // U (21) Razón
  Comentario_Justificacion: 22,     // V (22) Comentario Justificacion
  Responsable_Justificacion: 23,    // W (23) RESPONSABLE JUSTIFICACION
  Fecha_Reconteo: 24,               // X (24) Fecha reconteo
  Stock_Total_Reconteo: 25,         // Y (25) stock total reconteo
  Reconteo: 26,                     // Z (26) RECONTEO (BUEN ESTADO PRIMER RECONTEO)
  Malestado_Reconteo: 27,           // AA (27) MALESTADO RECONTEO (MAL ESTADO PRIMER RECONTEO)
  Diferencia_Final: 28,             // AB (28) Diferencia Final
  Costo_Diferencia_Final: 29,       // AC (29) Costo Diferencia Final
  Fecha_Justificacion_2: 30,        // AD (30) FECHA JUSTIFICACION 2
  Estado_Justificacion_2: 31,       // AE (31) ESTADO JUSTIFICACION 2
  Razon_Justificacion_2: 32,        // AF (32) RazónJUSTIFICACION 2
  Comentario_Justificacion_2: 33,   // AG (33) Comentario JustificaciON 2
  Responsable_Justificacion_2: 34,  // AH (34) RESPONSABLE JUSTIFICACION 2
  Fecha_Reconteo_2: 35,             // AI (35) Fecha reconteo 2
  Stock_Total_Reconteo_2: 36,       // AJ (36) stock total reconteo 2
  Reconteo_2: 37,                   // AK (37) RECONTEO 2 (BUEN ESTADO SEGUNDO RECONTEO)
  Malestado_Reconteo_2: 38,         // AL (38) MALESTADO RECONTEO 2 (MAL ESTADO SEGUNDO RECONTEO)
  Diferencia_Final_2: 39,           // AM (39) Diferencia Final 2
  Costo_Diferencia_Final_2: 40       // AN (40) Costo Diferencia Final 2
};

const DEFAULT_HEADERS = [
  'SKU',                          // A (1)
  'Codigo_Barras',                // B (2)
  'Descripcion',                  // C (3)
  'Ubicación',                    // D (4)
  'Ubicación 1',                  // E (5)
  'Ubicación 2',                  // F (6)
  'Almacen',                      // G (7)
  'Clasificacion_ABC',            // H (8)
  'Unidad',                       // I (9)
  'Costo_Unitario',               // J (10)
  'Stock_Sistema',                // K (11)
  'STOCK TOTAL',                  // L (12)
  'stock B/E',                    // M (13)
  'stock M/E',                    // N (14)
  'Diferencia',                   // O (15)
  'Costo_Diferencia',             // P (16)
  'Fecha_Ultimo_Conteo',          // Q (17)
  'Responsable',                  // R (18)
  'FECHA PRIMERA JUSTIFICACION',  // S (19)
  'Estado',                       // T (20)
  'Razón',                        // U (21)
  'Comentario Justificacion',     // V (22)
  'RESPONSABLE JUSTIFICACION',    // W (23)
  'Fecha reconteo',               // X (24)
  'stock total reconteo',         // Y (25)
  'RECONTEO',                     // Z (26)
  'MALESTADO RECONTEO',           // AA (27)
  'Diferencia Final',             // AB (28)
  'Costo Diferencia Final',       // AC (29)
  'FECHA JUSTIFICACION 2',        // AD (30)
  'ESTADO JUSTIFICACION 2',       // AE (31)
  'RazónJUSTIFICACION 2',         // AF (32)
  'Comentario JustificaciON 2',   // AG (33)
  'RESPONSABLE JUSTIFICACION 2',  // AH (34)
  'Fecha reconteo 2',             // AI (35)
  'stock total reconteo 2',       // AJ (36)
  'RECONTEO 2',                   // AK (37)
  'MALESTADO RECONTEO 2',         // AL (38)
  'Diferencia Final 2',           // AM (39)
  'Costo Diferencia Final 2'      // AN (40)
];

// Canonical quantities: Stock_Fisico is GOOD stock; Stock_Total includes damaged stock.
// Canonical quantities: Stock_Fisico is GOOD stock; Stock_Total includes damaged stock.
const InventoryContract = (() => {
  const columns = ["SKU","Codigo_Barras","Descripcion","Ubicacion","Ubicacion_1","Ubicacion_2","Almacen","Clasificacion_ABC","Unidad","Costo_Unitario","Stock_Sistema","Stock_Total","Stock_Buen_Estado","Mal_estado","Diferencia","Costo_Diferencia","Fecha_Ultimo_Conteo","Responsable","Fecha_Primera_Justificacion","Estado","Razon","Comentario_Justificacion","Responsable_Justificacion","Fecha_Reconteo","Stock_Total_Reconteo","Reconteo","Malestado_Reconteo","Diferencia_Final","Costo_Diferencia_Final","Fecha_Justificacion_2","Estado_Justificacion_2","Razon_Justificacion_2","Comentario_Justificacion_2","Responsable_Justificacion_2","Fecha_Reconteo_2","Stock_Total_Reconteo_2","Reconteo_2","Malestado_Reconteo_2","Diferencia_Final_2","Costo_Diferencia_Final_2"];
  const has = v => v !== undefined && v !== null && String(v).trim() !== '';
  const first = (...v) => v.find(has);
  const identity = v => String(v ?? '').trim().toUpperCase();
  function number(v, label, fallback = 0) {
    if (!has(v)) return fallback;
    if (typeof v === 'boolean' || !Number.isFinite(Number(v))) throw new Error('Número inválido: ' + label);
    return Number(v);
  }
  function quantity(v, label) {
    const n = number(v, label);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('Cantidad inválida: ' + label);
    return n;
  }
  function date(v) {
    const d = has(v) ? new Date(v) : new Date();
    if (!Number.isFinite(d.getTime())) throw new Error('Fecha inválida');
    return d.toISOString();
  }
  const stages = [
    ['Stock_Buen_Estado','Mal_estado','Stock_Total','Diferencia','Costo_Diferencia','Fecha_Ultimo_Conteo'],
    ['Reconteo','Malestado_Reconteo','Stock_Total_Reconteo','Diferencia_Final','Costo_Diferencia_Final','Fecha_Reconteo'],
    ['Reconteo_2','Malestado_Reconteo_2','Stock_Total_Reconteo_2','Diferencia_Final_2','Costo_Diferencia_Final_2','Fecha_Reconteo_2']
  ];
  function normalize(raw) {
    const r = {...raw};
    r.SKU = identity(first(raw.SKU, raw.sku));
    r.Almacen = String(first(raw.Almacen, raw.almacen, raw.warehouse) ?? '').trim();
    r.Ubicacion = String(first(raw.Ubicacion, raw.ubicacion, raw.location) ?? '').trim();
    r.Stock_Sistema = number(first(raw.Stock_Sistema, raw.stockSistema), 'Stock_Sistema');
    r.Costo_Unitario = number(first(raw.Costo_Unitario, raw.costoUnitario), 'Costo_Unitario');
    r.Reconteo = first(raw.Reconteo, raw.Reconteo_Fisico) ?? null;
    r.Malestado_Reconteo = first(raw.Malestado_Reconteo, raw.Reconteo_Mal_Estado) ?? null;
    if (!has(r.Stock_Buen_Estado)) {
      r.Stock_Buen_Estado = has(r.Stock_Total)
        ? number(r.Stock_Total, 'Stock_Total') - number(r.Mal_estado, 'Mal_estado')
        : first(raw.Stock_Fisico, raw.stockFisico) ?? null;
    }
    for (const [good,bad,total,diff,cost] of stages) {
      if (!has(r[good]) && !has(r[total])) { r[good]=null; r[bad]=has(r[bad])?quantity(r[bad],bad):null; r[total]=null; continue; }
      r[bad] = quantity(r[bad], bad);
      r[good] = quantity(has(r[good]) ? r[good] : number(r[total],total)-r[bad],good);
      const sum=r[good]+r[bad];
      if (!Number.isSafeInteger(sum)) throw new Error('Total fuera de rango: '+total);
      if (has(r[total]) && quantity(r[total],total)!==sum) throw new Error('Total inconsistente: '+total);
      r[total]=sum;
      r[diff]=has(r[diff])?number(r[diff],diff):sum-r.Stock_Sistema;
      r[cost]=r[diff]*r.Costo_Unitario;
    }
    r.Stock_Fisico=r.Stock_Buen_Estado;
    r.Reconteo_Fisico=r.Reconteo;
    r.Reconteo_Mal_Estado=r.Malestado_Reconteo;
    return r;
  }
  function status(p) {
    const raw=identity(first(p.corroboracion,p.corroboration,p.estadoJustificacion2,p.estadoJustificacion,p.estado,p.status)).replace(/_/g,' ');
    if (p.isCuadra===false || raw==='NO CUADRA') return 'NO CUADRA';
    if (p.isCuadra===true || raw==='CUADRA') return 'CUADRA';
    throw new Error('Indique CUADRA o NO CUADRA');
  }
  function update(original,p) {
    const r=normalize(original);
    const rec2=p.isReconteo2===true || ['RECONTEO_2','RECONTEO 2'].includes(identity(p.countPhase));
    const rec1=!rec2 && (p.isReconteo===true || ['RECONTEO','RECONTEO_1','RECONTEO 1'].includes(identity(p.countPhase)));
    const inputs=[
      [first(p.stockBuenEstado,p.stockFisico),p.malEstado,p.stockTotal,p.fechaUltimoConteo],
      [first(p.reconteo,p.reconteoFisico,p.RECONTEO),first(p.malestadoReconteo,p.reconteoMalEstado,p.MALESTADO_RECONTEO),p.stockTotalReconteo,p.fechaReconteo],
      [first(p.reconteo2,p.RECONTEO_2),first(p.malestadoReconteo2,p.MALESTADO_RECONTEO_2),p.stockTotalReconteo2,p.fechaReconteo2]
    ];
    let countChanged=false;
    inputs.forEach((values,i)=>{
      if ((i===0 && (rec1||rec2)) || (i===1 && rec2)) return;
      const [g,b,t,d]=values;
      if (![g,b,t].some(has)) return;
      countChanged=true;
      const [good,bad,total,,,when]=stages[i];
      const badQty=quantity(has(b)?b:r[bad],bad);
      const goodQty=has(g)?quantity(g,good):(has(t)?quantity(number(t,total)-badQty,good):quantity(r[good],good));
      const sum=goodQty+badQty;
      if (!Number.isSafeInteger(sum) || (has(t)&&quantity(t,total)!==sum)) throw new Error('Total inconsistente: '+total);
      r[good]=goodQty;r[bad]=badQty;r[total]=sum;r[when]=date(d);
      if(i===0 && has(first(p.responsable,p.username))) r.Responsable=first(p.responsable,p.username);
    });
    for (const [field,alias] of [['Ubicacion_1','ubicacion1'],['Ubicacion_2','ubicacion2']]) {
      if(Object.prototype.hasOwnProperty.call(p,alias)||Object.prototype.hasOwnProperty.call(p,field))
        r[field]=String(p[alias]??p[field]??'').trim();
    }
    if(p.isNewLocation){
      const loc=String(first(p.newLocation,p.location)??'').trim();
      if(!loc) throw new Error('Falta la nueva ubicación');
      const locations=[r.Ubicacion,r.Ubicacion_1,r.Ubicacion_2].map(identity);
      if(!locations.includes(identity(loc))){
        if(!has(r.Ubicacion_1))r.Ubicacion_1=loc;
        else if(!has(r.Ubicacion_2))r.Ubicacion_2=loc;
        else throw new Error('Máximo de dos ubicaciones adicionales');
      }
    }
    const locations=[r.Ubicacion,r.Ubicacion_1,r.Ubicacion_2].filter(has).map(identity);
    if(new Set(locations).size!==locations.length)throw new Error('Ubicaciones duplicadas');
    const justification=p.action==='saveJustification'||[p.isCuadra,p.corroboracion,p.corroboration,p.estadoJustificacion,p.estadoJustificacion2].some(has);
    let resolved=false;
    if(justification){
      const round=Number(p.round??p.justificationRound??(p.isJustification2?2:1));
      if(![1,2].includes(round))throw new Error('Ronda de justificación inválida');
      const state=status(p);
      const originalStock=first(p.originalStockSistema,p.stockSistemaOriginal,r.Stock_Sistema_Original,r.Stock_Sistema);
      r.Stock_Sistema_Original=number(originalStock,'Stock_Sistema_Original');
      if(state==='CUADRA'){
        const latest=[r.Stock_Total_Reconteo_2,r.Stock_Total_Reconteo,r.Stock_Total].find(has);
        if(!has(latest))throw new Error('No se puede justificar sin conteo');
        r.Stock_Sistema=latest;resolved=true;
      }else r.Stock_Sistema=r.Stock_Sistema_Original;
      const second=round===2;
      r[second?'Fecha_Justificacion_2':'Fecha_Primera_Justificacion']=date(first(second?p.fechaJustificacion2:p.fechaPrimeraJustificacion,p.fecha));
      r[second?'Estado_Justificacion_2':'Estado']=state;
      r[second?'Razon_Justificacion_2':'Razon']=first(second?p.razonJustificacion2:null,p.razon,p.reasonType,p.razonJustificacion)??'AJUSTE_INVENTARIO';
      r[second?'Comentario_Justificacion_2':'Comentario_Justificacion']=first(second?p.comentarioJustificacion2:null,p.comentarioJustificacion,p.justification)??'';
      const reviewer=first(second?p.responsableJustificacion2:null,p.responsableJustificacion,p.reviewedBy,p.reviewer);
      if(has(reviewer))r[second?'Responsable_Justificacion_2':'Responsable_Justificacion']=reviewer;
    }
    if(countChanged||justification)for(const [, ,total,diff,cost] of stages){
      if(has(r[total])){r[diff]=resolved?0:r[total]-r.Stock_Sistema;r[cost]=r[diff]*r.Costo_Unitario;}
    }
    return normalize(r);
  }
  function finalItem(raw){
    const r=normalize(raw);
    if(!r.SKU||!r.Almacen||!has(r.Stock_Total))throw new Error('Cierre incompleto: SKU, almacén y primer conteo son obligatorios');
    return Object.fromEntries(columns.map(k=>[k,r[k]??'']));
  }
  function member(r){return JSON.stringify([identity(r.SKU||r.sku),identity(r.Almacen||r.almacen||r.warehouse),identity(r.Ubicacion||r.ubicacion||r.location)]);}
  return {columns,stages,has,first,identity,number,quantity,date,normalize,status,update,finalItem,member};
})();



function onOpen(){
  SpreadsheetApp.getUi().createMenu('📦 Inventarios')
    .addItem('Actualizar maestros desde BD_BASE (conservar conteos)','distribuirBaseACentros')
    .addItem('Verificar columnas','asegurarTodasLasColumnas').addToUi();
}
function json_(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
function property_(key){return PropertiesService.getScriptProperties().getProperty(key);}
function spreadsheet_(){const id=property_('INVENTORY_SPREADSHEET_ID');const ss=id?SpreadsheetApp.openById(id):SpreadsheetApp.getActiveSpreadsheet();if(!ss)throw new Error('Configure INVENTORY_SPREADSHEET_ID');return ss;}
function authenticate_(p){
  const expected=property_('APPS_SCRIPT_TOKEN');
  if(!expected||String(p.apiToken||'')!==expected)throw new Error('Acceso no autorizado');
}
function doGet(e){
  const p=(e&&e.parameter)||{};
  if(!p.action||p.action==='ping')return json_({success:true,version:2,message:'Inventarios API',timestamp:new Date().toISOString()});
  try{authenticate_(p);return json_(dispatchRead_(p));}catch(e){return json_({success:false,error:e.message});}
}
function doPost(e){
  let lock;
  try{
    const body=JSON.parse(e?.postData?.contents||'{}');authenticate_(body);
    const readActions=['ping','getItems','getProducts','readItems','getHistory','listFinalFiles','readFinalInventory','getReferencePhoto','getLogos','listLogos','diagnostic'];
    if(readActions.includes(body.action))return json_(dispatchRead_(body));
    lock=LockService.getScriptLock();
    if(!lock.tryLock(25000))return json_({success:false,retryable:true,error:'Servidor ocupado. Reintente con el mismo operationId.'});
    const clean={...body};delete clean.apiToken;
    // A close retry can have a new wall-clock date; its immutable rows/identity determine the operation.
    if(clean.action==='createFinalFile'&&clean.driveRecord){clean.driveRecord={...clean.driveRecord};delete clean.driveRecord.closedAt;}
    const fingerprint=hash_(JSON.stringify(clean)),id=String(body.operationId||'');
    if(!id)throw new Error('Falta operationId');
    const previous=readOperation_(id);
    if(previous){if(previous.hash!==fingerprint)throw new Error('operationId reutilizado con datos diferentes');return json_(previous.result);}
    let result;
    switch(body.action){
      case 'upsertCount':result=upsertCount_(body);break;
      case 'batchUpsertCounts':result=batchUpsertCounts_(body);break;
      case 'saveJustification':result=upsertCount_({...body,action:'saveJustification'});break;
      case 'deleteAdditionalLocation':case 'deleteItem':result=deleteAdditionalLocation_(body);break;
      case 'createFinalFile':result=createFinalFile_(body);break;
      case 'savePhoto':case 'uploadPhoto':result=savePhotoDirectly_(body);break;
      default:throw new Error('Acción no soportada: '+body.action);
    }
    result={success:true,action:body.action,...result};
    SpreadsheetApp.flush();
    if(result.success)confirmOperation_(id,fingerprint,result);
    return json_(result);
  }catch(e){return json_({success:false,error:e.message});}
  finally{if(lock?.hasLock())lock.releaseLock();}
}
function dispatchRead_(p){
  switch(p.action){
    case 'ping':return {success:true,version:2};
    case 'getItems':case 'getProducts':case 'readItems':{
      const items=readRowsAsObjects_(getCenterSheet_(p.center||p.centro));
      return {success:true,center:p.center,items,total:items.length};
    }
    case 'getHistory':case 'listFinalFiles':{const history=getHistory_(p.type,p.center);return {success:true,history,count:history.length};}
    case 'readFinalInventory':return {success:true,...readFinalInventory_(p)};
    case 'getReferencePhoto':return {success:true,photo:getReferencePhotoBySku_(p.sku)};
    case 'getLogos':case 'listLogos':{
      const folder=DriveApp.getFolderById(property_('LOGOS_FOLDER_ID')||'1ZECgK7i8DAqXH0K3quRqaIlcnbpF7nSe');
      const it=folder.getFiles(),logos=[];while(it.hasNext()){const f=it.next();logos.push({id:f.getId(),name:f.getName(),url:f.getUrl(),downloadUrl:'https://drive.google.com/uc?export=download&id='+f.getId()});}return {success:true,logos};
    }
    case 'diagnostic':return {success:true,version:2,sheets:spreadsheet_().getSheets().filter(s=>/^\d{4}$/.test(s.getName())).map(s=>({name:s.getName(),rows:s.getLastRow(),cols:s.getLastColumn()}))};
    default:throw new Error('Acción de lectura no soportada');
  }
}
function hash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value)).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function operationSheet_(){const ss=spreadsheet_();let sh=ss.getSheetByName('_NIBOL_SYNC');if(!sh){sh=ss.insertSheet('_NIBOL_SYNC');sh.appendRow(['Operacion','Resultado','Fecha','RequestHash']);sh.hideSheet();}return sh;}
function readOperation_(id){
  const sh=operationSheet_();if(sh.getLastRow()<2)return null;
  const cell=sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(id).matchEntireCell(true).useRegularExpression(false).findNext();
  if(!cell)return null;const r=sh.getRange(cell.getRow(),1,1,4).getValues()[0];return {hash:r[3],result:JSON.parse(r[1])};
}
function confirmOperation_(id,hash,result){const value=JSON.stringify(result);if(value.length>45000)throw new Error('Respuesta demasiado grande para confirmar la operación');operationSheet_().appendRow([id,value,new Date(),hash]);}
function getCenterSheet_(center,ss){
  const clean=String(center||'').trim();if(!/^\d{4}$/.test(clean))throw new Error('Centro inválido: '+clean);
  const sh=(ss||spreadsheet_()).getSheetByName(clean);if(!sh)throw new Error('No existe la pestaña del centro '+clean);
  validateHeaders_(sh);return sh;
}
function ensureColumns_(sh){
  if(sh.getMaxColumns()<40)sh.insertColumnsAfter(sh.getMaxColumns(),40-sh.getMaxColumns());
  if(!sh.getLastRow())sh.getRange(1,1,1,40).setValues([DEFAULT_HEADERS]);
  validateHeaders_(sh);
}
function headerKey_(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function validateHeaders_(sh){
  if(sh.getMaxColumns()<40)throw new Error('La hoja '+sh.getName()+' requiere 40 columnas; no se migran datos por posición automáticamente');
  const headers=sh.getRange(1,1,1,40).getDisplayValues()[0];
  DEFAULT_HEADERS.forEach((h,i)=>{if(headerKey_(headers[i])!==headerKey_(h))throw new Error('Encabezado inesperado en '+sh.getName()+', columna '+(i+1)+': se esperaba '+h);});
}
function rowToObject_(row){const obj=Object.fromEntries(InventoryContract.columns.map((k,i)=>[k,row[i]]));return InventoryContract.normalize(obj);}
function readRowsAsObjects_(sh){validateHeaders_(sh);return sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,40).getValues().filter(r=>r.some(v=>v!==''&&v!==null)).map(rowToObject_);}
function rowValues_(item){return InventoryContract.columns.map(k=>k.startsWith('Fecha_')&&InventoryContract.has(item[k])?new Date(InventoryContract.date(item[k])):(item[k]??''));}
function findRowInSheet_(sh,p,rows){
  const sku=InventoryContract.identity(p.sku||p.SKU),bar=InventoryContract.identity(p.barcode||p.codigoBarras||p.Codigo_Barras);
  const war=InventoryContract.identity(p.almacen||p.warehouse||p.Almacen);
  const loc=InventoryContract.identity(p.originalLocation||(p.isNewLocation?'':p.location||p.ubicacion||p.Ubicacion));
  const data=rows|| (sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,40).getValues():[]);
  const matches=[];
  data.forEach((row,i)=>{
    if(sku?InventoryContract.identity(row[0])!==sku:!bar||InventoryContract.identity(row[1])!==bar)return;
    if(war&&InventoryContract.identity(row[6])!==war)return;
    if(loc&&!row.slice(3,6).some(v=>InventoryContract.identity(v)===loc))return;
    matches.push({rowNumber:i+2,row});
  });
  if(matches.length>1)throw new Error('SKU ambiguo: indique almacén y ubicación');
  return matches[0]||null;
}
function upsertCount_(p,batch){
  if(!p.sku&&!p.SKU&&!p.barcode&&!p.Codigo_Barras)throw new Error('Falta SKU o código de barras');
  const sh=batch?.sheet||getCenterSheet_(p.center||p.centro);
  let found=findRowInSheet_(sh,p,batch?.rows),created=false,original;
  if(!found){
    if(p.action==='saveJustification'||(String(p.type).toUpperCase()!=='BARRIDO'&&p.allowNewItem!==true))throw new Error('Ítem no encontrado');
    if(!p.almacen&&!p.warehouse&&!p.Almacen)throw new Error('Falta almacén');
    original={SKU:p.sku||p.SKU,Codigo_Barras:p.barcode||p.Codigo_Barras||p.sku,Descripcion:p.descripcion||p.Descripcion||'',
      Ubicacion:p.location||p.Ubicacion||'PRINCIPAL',Almacen:p.almacen||p.warehouse||p.Almacen,Clasificacion_ABC:p.clasificacionAbc||'C',
      Unidad:p.unidad||'PZA',Costo_Unitario:p.costoUnitario??0,Stock_Sistema:p.stockSistema??0};
    found={rowNumber:sh.getLastRow()+1};created=true;
  }else original=rowToObject_(found.row);
  if(p.action==='saveJustification'||[p.isCuadra,p.corroboracion,p.corroboration,p.estadoJustificacion,p.estadoJustificacion2].some(InventoryContract.has)){
    p={...p,originalStockSistema:originalStock_(p,original)};
  }
  const item=InventoryContract.update(original,p);
  // Validate/save evidence first. A failed photo must not leave an unconfirmed stock write.
  const photoSaved=p.action==='saveJustification'?null:savePhotoIfAny_(p,p.center,p.type,item.SKU,'malestado');
  const justPhotoSaved=savePhotoIfAny_(p,p.center,p.type,item.SKU,'justificaciones');
  if(found.rowNumber>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),1);
  if(created)sh.getRange(found.rowNumber,1,1,40).setValues([rowValues_(item)]);
  else {sh.getRange(found.rowNumber,5,1,2).setValues([[item.Ubicacion_1||'',item.Ubicacion_2||'']]);sh.getRange(found.rowNumber,11,1,30).setValues([rowValues_(item).slice(10)]);}
  if(batch){if(created)batch.rows.push(rowValues_(item));else batch.rows[found.rowNumber-2]=rowValues_(item);}
  return {center:p.center,row:found.rowNumber,sku:item.SKU,isNewItem:created,item,stockSistemaReescrito:item.Stock_Sistema,photoSaved,justPhotoSaved};
}
function batchUpsertCounts_(p){
  if(!Array.isArray(p.updates)||p.updates.length>200)throw new Error('Lote inválido (máximo 200)');
  const sheet=getCenterSheet_(p.center),batch={sheet,rows:sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,40).getValues():[]};
  const failedItems=[];let updatedCount=0,createdCount=0;
  p.updates.forEach((it,index)=>{try{const r=upsertCount_({...it,center:p.center,type:p.type},batch);if(r.isNewItem)createdCount++;else updatedCount++;}catch(e){failedItems.push({index,sku:it.sku||it.SKU,error:e.message});}});
  return {success:failedItems.length===0,total:p.updates.length,updatedCount,createdCount,failedItems};
}
function deleteAdditionalLocation_(p){
  const sh=getCenterSheet_(p.center),found=findRowInSheet_(sh,{...p,location:p.originalLocation||''});
  if(!found)throw new Error('Ítem no encontrado');
  const row=found.row,loc=InventoryContract.identity(p.location),slot=Number(p.slot||p.locationSlot||0);
  if(slot&&! [1,2].includes(slot))throw new Error('Slot inválido');
  const pos=slot?slot+3:[4,5].find(i=>loc&&InventoryContract.identity(row[i])===loc);
  if(pos===undefined||!row[pos]||(loc&&InventoryContract.identity(row[pos])!==loc))throw new Error('Ubicación adicional no encontrada');
  if(pos===4){row[4]=row[5]||'';row[5]='';}else row[5]='';
  sh.getRange(found.rowNumber,5,1,2).setValues([[row[4],row[5]]]);
  return {cleared:true,sku:row[0],ubicacion1:row[4],ubicacion2:row[5]};
}


function type_(value){const t=String(value||'CICLICO').toUpperCase().trim();const aliases={SEMANAL:'CICLICO',SEMANALES:'CICLICO',MENSUAL:'GENERAL',MENSUALES:'GENERAL'};return aliases[t]||t;}
function driveFolderId_(value,label){
  const raw=String(value||'').trim();
  if(!raw)throw new Error('Configure '+label+' con el ID de una carpeta de Google Drive');
  const fromUrl=raw.match(/drive\.google\.com\/(?:drive\/)?folders\/([a-zA-Z0-9_-]+)/i)
    ||raw.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  const id=fromUrl?fromUrl[1]:raw;
  if(!/^[a-zA-Z0-9_-]{10,}$/.test(id))throw new Error(label+' debe ser un ID de carpeta o enlace de carpeta válido de Drive');
  return id;
}
function getDriveFolder_(value,label){
  const id=driveFolderId_(value,label);
  try{return DriveApp.getFolderById(id);}
  catch(err){throw new Error(label+' ('+id+') no existe o la cuenta que ejecuta Apps Script no tiene acceso. Verifique el ID y comparta la carpeta con esa cuenta.');}
}
function getRootFolderForType_(type){
  const rawType=String(type||'CICLICO').toUpperCase().trim(),normalized=type_(rawType);
  const key='ROOT_'+rawType;
  const id=property_(key)||property_('ROOT_'+normalized);
  if(!id)throw new Error('Falta '+key+' en Propiedades del script. Pegue el ID de la carpeta raíz de fotos/cierres.');
  return getDriveFolder_(id,key);
}
function getOrCreateFolder_(parent,name){if(!String(name).trim())throw new Error('Nombre de carpeta vacío');const it=parent.getFoldersByName(String(name));return it.hasNext()?it.next():parent.createFolder(String(name));}
function manifestFor_(p,sh,items){
  const record=p.driveRecord||{},members=items.map(InventoryContract.member).sort();
  return {version:2,inventoryId:record.inventoryId||p.inventoryId,operationId:p.operationId,center:String(p.center),type:p.type||'CICLICO',
    gid:sh.getSheetId(),sheetName:sh.getName(),closedAt:record.closedAt||new Date().toISOString(),itemCount:items.length,
    skuCount:new Set(items.map(it=>it.SKU)).size,membershipHash:hash_(JSON.stringify(members)),members};
}
function createFinalFile_(p){
  const record=p.driveRecord||{},items=(record.items||p.items||[]).map(InventoryContract.finalItem);
  if(!items.length)throw new Error('No se puede crear un cierre vacío');
  getCenterSheet_(p.center);
  const members=items.map(InventoryContract.member);
  if(new Set(members).size!==members.length)throw new Error('Identidades duplicadas en el cierre');
  // Rows already contain both rounds and the confirmed calculations. Do not reinterpret CUADRA during export.
  const folder=getOrCreateFolder_(getOrCreateFolder_(getRootFolderForType_(p.type),String(p.center)),'Archivos Finales');
  const payloadHash=hash_(JSON.stringify({items,inventoryId:record.inventoryId,center:p.center,type:p.type,justifications:record.justifications||[]}));
  const existing=folder.getFiles();
  while(existing.hasNext()){
    const f=existing.next();let m;try{m=JSON.parse(f.getDescription()||'{}');}catch(_){continue;}
    if(m.operationId===p.operationId){
      if(m.payloadHash!==payloadHash)throw new Error('Cierre repetido con contenido diferente');
      if(m.complete)return m.result;
    }
  }
  let copy;
  try{
    const stamp=Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'America/La_Paz','yyyyMMdd_HHmmss');
    copy=DriveApp.getFileById(spreadsheet_().getId()).makeCopy('Inventario_'+p.type+'_'+p.center+'_FINAL_'+stamp,folder);
    const ss=SpreadsheetApp.openById(copy.getId()),sh=getCenterSheet_(p.center,ss);
    ss.getSheets().forEach(s=>{if(s.getSheetId()!==sh.getSheetId())ss.deleteSheet(s);});
    if(sh.getMaxRows()<items.length+1)sh.insertRowsAfter(sh.getMaxRows(),items.length+1-sh.getMaxRows());
    if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,40).clearContent();
    sh.getRange(1,1,1,40).setValues([DEFAULT_HEADERS]);
    [10,11,12,13,14,15,16,25,26,27,28,29,36,37,38,39,40].forEach(c=>sh.getRange(2,c,items.length,1).setNumberFormat('0.##########'));
    sh.getRange(2,1,items.length,40).setValues(items.map(rowValues_));
    if(sh.getMaxColumns()>40)sh.deleteColumns(41,sh.getMaxColumns()-40);
    const manifest=manifestFor_(p,sh,items),summary={...manifest};delete summary.members;
    const meta=ss.insertSheet('__INVENTORY_MANIFEST');
    if(meta.getMaxRows()<members.length+1)meta.insertRowsAfter(meta.getMaxRows(),members.length+1-meta.getMaxRows());
    meta.getRange(1,1).setValue(JSON.stringify(summary));meta.getRange(2,1,members.length,1).setValues(manifest.members.map(m=>[m]));meta.hideSheet();
    // Preserve complete evidence metadata, including round and exact item identity.
    const justifications=record.justifications||[];
    if(justifications.length){
      const evidence=ss.insertSheet('__JUSTIFICATIONS');
      if(evidence.getMaxRows()<justifications.length+1)evidence.insertRowsAfter(evidence.getMaxRows(),justifications.length+1-evidence.getMaxRows());
      evidence.getRange(1,1).setValue('Justificaciones y evidencia');
      const entries=justifications.map(j=>{
        const saved=savePhotoIfAny_({...j,action:'saveJustification',photoJustificacion:j.photoBase64||j.photoUrl||j.driveUrl},p.center,p.type,j.sku||j.SKU,'justificaciones');
        const cleaned={...j};delete cleaned.photoBase64;
        if(saved)cleaned.driveFileId=saved.id;
        const text=JSON.stringify(cleaned);if(text.length>45000)throw new Error('Justificación demasiado extensa');
        return [text];
      });
      evidence.getRange(2,1,entries.length,1).setValues(entries);evidence.hideSheet();
    }
    SpreadsheetApp.flush();
    const result={fileId:copy.getId(),fileName:copy.getName(),spreadsheetUrl:copy.getUrl()+'#gid='+sh.getSheetId(),
      folderId:folder.getId(),center:p.center,type:p.type,itemsSynced:items.length,manifest:summary};
    copy.setDescription(JSON.stringify({complete:true,operationId:p.operationId,payloadHash,inventoryManifest:summary,result}));
    return result;
  }catch(e){if(copy)copy.setTrashed(true);throw e;}
}
function allowedRoots_(){
  const props=PropertiesService.getScriptProperties().getProperties();
  const configured=Object.entries(props).filter(([k])=>k.startsWith('ROOT_')).map(([k,v])=>driveFolderId_(v,k));
  return [...new Set([...configured,...Object.values(CFG.driveRoots).filter(Boolean).map(v=>driveFolderId_(v,'CFG.driveRoots'))])];
}
function belongsToRoot_(file,rootIds){
  const queue=[],parents=file.getParents(),seen=new Set();while(parents.hasNext())queue.push(parents.next());
  while(queue.length){const f=queue.shift();if(rootIds.includes(f.getId()))return true;if(seen.has(f.getId()))continue;seen.add(f.getId());
    const pp=f.getParents();while(pp.hasNext())queue.push(pp.next());}return false;
}
function readFinalInventory_(p){
  const id=String(p.spreadsheetId||'');if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('Identificador inválido');
  const file=DriveApp.getFileById(id),parents=file.getParents();let final=false;
  while(parents.hasNext())if(parents.next().getName()==='Archivos Finales')final=true;
  if(!final||!belongsToRoot_(file,allowedRoots_()))throw new Error('Archivo fuera de las carpetas de cierres autorizadas');
  const ss=SpreadsheetApp.openById(id),meta=ss.getSheetByName('__INVENTORY_MANIFEST');
  if(!meta){
    if(!/^\d{4}$/.test(String(p.center||'')))throw new Error('Cierre antiguo: indique el centro exacto');
    const legacy=p.gid!==undefined?ss.getSheets().find(s=>String(s.getSheetId())===String(p.gid)):ss.getSheetByName(String(p.center));
    if(!legacy||legacy.getName()!==String(p.center))throw new Error('La pestaña no corresponde al centro');
    validateHeaders_(legacy);
    return {headers:DEFAULT_HEADERS,rows:legacy.getLastRow()>1?legacy.getRange(2,1,legacy.getLastRow()-1,40).getValues():[],
      manifest:null,legacy:true,sheetName:legacy.getName(),gid:legacy.getSheetId(),spreadsheetId:id,
      spreadsheetTimeZone:ss.getSpreadsheetTimeZone(),modifiedAt:file.getLastUpdated().toISOString()};
  }
  const manifest=JSON.parse(meta.getRange(1,1).getValue());
  if(p.center&&String(p.center)!==String(manifest.center))throw new Error('Centro incorrecto');
  if(p.gid!==undefined&&String(p.gid)!==String(manifest.gid))throw new Error('Pestaña incorrecta');
  const sh=ss.getSheets().find(s=>s.getSheetId()===Number(manifest.gid));if(!sh)throw new Error('Pestaña del cierre ausente');
  validateHeaders_(sh);
  const rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,40).getValues():[];
  manifest.members=meta.getLastRow()>1?meta.getRange(2,1,meta.getLastRow()-1,1).getValues().map(r=>r[0]):[];
  const actual=rows.map(rowToObject_).map(InventoryContract.member).sort();
  if(actual.length!==manifest.itemCount||JSON.stringify(actual)!==JSON.stringify(manifest.members.slice().sort()))throw new Error('El contenido del cierre no coincide con su manifiesto');
  return {headers:DEFAULT_HEADERS,rows,manifest,sheetName:sh.getName(),gid:sh.getSheetId(),spreadsheetId:id,spreadsheetTimeZone:ss.getSpreadsheetTimeZone(),modifiedAt:file.getLastUpdated().toISOString()};
}
function getHistory_(type,center){
  const root=getRootFolderForType_(type),centers=[];
  if(center)centers.push(String(center));else{const it=root.getFolders();while(it.hasNext()){const f=it.next();if(/^\d{4}$/.test(f.getName()))centers.push(f.getName());}}
  const history=[];
  centers.forEach(c=>{const cs=root.getFoldersByName(c);while(cs.hasNext()){const fs=cs.next().getFoldersByName('Archivos Finales');while(fs.hasNext()){const files=fs.next().getFiles();while(files.hasNext()){
    const f=files.next();let metadata;try{metadata=JSON.parse(f.getDescription()||'{}');}catch(_){continue;}
    const m=metadata.inventoryManifest;if(!m||metadata.complete===false)continue;
    if(type&&String(m.type)!==String(type))continue;
    history.push({fileId:f.getId(),fileName:f.getName(),driveUrl:f.getUrl(),spreadsheetUrl:f.getUrl()+'#gid='+m.gid,
      inventoryId:m.inventoryId,center:c,type:m.type,closedAt:m.closedAt,modifiedAt:f.getLastUpdated().toISOString(),manifest:m,totalItems:m.itemCount,source:'GOOGLE_DRIVE'});
  }}}});
  return history;
}


function savePhotoDirectly_(p){
  const category=String(p.category||p.photoType||'malestado').toLowerCase().includes('just')?'justificaciones':'malestado';
  const photo=savePhotoIfAny_(p,p.center,p.type,p.sku||p.SKU||p.barcode,category);
  if(!photo)throw new Error('Falta una imagen válida');
  return {photo,category,sku:p.sku,center:p.center};
}
function savePhotoIfAny_(p,center,type,sku,category){
  const isJust=p.action==='saveJustification'||String(p.category||p.photoType||'').toLowerCase().includes('just');
  let value;
  if(category==='justificaciones')value=p.photoJustificacion||p.justificationPhoto||(isJust?(p.photoBase64||p.photoUrl||p.photo):null);
  else if(!isJust)value=p.photoBase64||p.foto_mal_estado||p.photoUrl||p.photo;
  if(!value)return null;
  if(typeof value!=='string')throw new Error('Imagen inválida');
  const photoRoot=property_('PHOTOS_ROOT_ID');
  const roots=allowedRoots_().concat(photoRoot?[driveFolderId_(photoRoot,'PHOTOS_ROOT_ID')]:[]);
  if(value.startsWith('https://')){
    const match=value.match(/^https:\/\/(?:drive\.google\.com|lh3\.googleusercontent\.com)\/(?:file\/d\/|d\/|.*[?&]id=)([-\w]+)/);
    if(!match)throw new Error('La foto debe ser base64 o una referencia válida de Drive');
    const f=DriveApp.getFileById(match[1]);
    if(!f.getMimeType().startsWith('image/')||!belongsToRoot_(f,roots))throw new Error('Foto fuera de la carpeta autorizada');
    return {id:f.getId(),name:f.getName(),url:f.getUrl(),mimeType:f.getMimeType()};
  }
  const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if(!match)throw new Error('Formato inválido: use JPEG, PNG o WebP base64');
  const bytes=Utilities.base64Decode(match[2]);if(!bytes.length||bytes.length>10*1024*1024)throw new Error('Tamaño inválido (máximo 10 MB)');
  if(!/^\d{4}$/.test(String(center||'')))throw new Error('Centro inválido para foto');
  const when=new Date(p.date||p.fecha||new Date());if(!Number.isFinite(when.getTime()))throw new Error('Fecha de foto inválida');
  const tag=Utilities.formatDate(when,Session.getScriptTimeZone()||'America/La_Paz','yyyy-MM-dd');
  const photosRoot=property_('PHOTOS_ROOT_ID');
  let folder=photosRoot?getDriveFolder_(photosRoot,'PHOTOS_ROOT_ID'):getRootFolderForType_(type);
  ['fotos',category,tag,String(center)+' '+String(type||'CICLICO')].forEach(seg=>{folder=getOrCreateFolder_(folder,seg);});
  const ext=match[1]==='image/png'?'.png':match[1]==='image/webp'?'.webp':'.jpg';
  const digest=hash_(JSON.stringify([p.inventoryId||'',p.itemId||sku,p.almacen||p.warehouse||'',p.location||p.ubicacion||'',p.round||(p.isJustification2?2:1),value]));
  const name=String(sku||'SKU').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,60)+'_'+digest+ext;
  const existing=folder.getFilesByName(name),file=existing.hasNext()?existing.next():folder.createFile(Utilities.newBlob(bytes,match[1],name));
  if(property_('PHOTO_LINK_SHARING')==='true')file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
  return {id:file.getId(),name:file.getName(),url:file.getUrl(),mimeType:file.getMimeType(),folderId:folder.getId(),folderName:folder.getName()};
}
function getReferencePhotoBySku_(sku){
  const root=property_('REFERENCE_PHOTOS_FOLDER_ID');if(!root||!sku)return null;
  const files=DriveApp.getFolderById(root).getFiles(),key=InventoryContract.identity(sku);
  while(files.hasNext()){
    const f=files.next();if(!f.getMimeType().startsWith('image/'))continue;
    const basename=InventoryContract.identity(f.getName().replace(/\.[^.]+$/,''));
    if(basename!==key)continue;
    return {id:f.getId(),name:f.getName(),mimeType:f.getMimeType(),viewUrl:f.getUrl(),
      downloadUrl:'https://drive.google.com/uc?export=view&id='+f.getId(),thumbnailUrl:'https://drive.google.com/thumbnail?id='+f.getId()+'&sz=w800'};
  }
  return null;
}
function asegurarTodasLasColumnas(){
  const lock=LockService.getScriptLock();lock.waitLock(25000);
  try{spreadsheet_().getSheets().filter(s=>/^\d{4}$/.test(s.getName())).forEach(ensureColumns_);SpreadsheetApp.flush();}
  finally{lock.releaseLock();}
  SpreadsheetApp.getUi().alert('Columnas verificadas. No se reordenaron ni sobrescribieron datos.');
}
function distribuirBaseACentros(){
  const lock=LockService.getScriptLock();lock.waitLock(25000);
  try{
    const ss=spreadsheet_(),base=ss.getSheetByName('BD_BASE');if(!base||base.getLastRow()<2)throw new Error('BD_BASE no existe o está vacía');
    const all=base.getDataRange().getValues(),headers=all.shift().map(headerKey_);
    const centerIndex=headers.findIndex(h=>['centro','center','codigocentro'].includes(h));
    const indexes=DEFAULT_HEADERS.slice(0,11).map(h=>headers.indexOf(headerKey_(h)));
    [0,1,2,3,6,7,8,9,10].forEach(i=>{if(indexes[i]<0)throw new Error('Falta columna en BD_BASE: '+DEFAULT_HEADERS[i]);});
    const groups={};
    all.filter(r=>r.some(InventoryContract.has)).forEach(r=>{
      const center=String(centerIndex>=0?r[centerIndex]:r[indexes[6]]).trim();
      if(!/^\d{4}$/.test(center))throw new Error('BD_BASE requiere una columna Centro cuando Almacen no es el código de cuatro dígitos');
      const row=Array(40).fill('');indexes.forEach((idx,i)=>{if(idx>=0)row[i]=r[idx]??'';});
      const item=rowToObject_(row);if(!item.SKU)throw new Error('SKU vacío en BD_BASE');
      if (!groups[center]) groups[center] = [];
      groups[center].push(rowValues_(item));
    });
    // Validate all existing sheets and all incoming identities before any write.
    Object.entries(groups).forEach(([center,rows])=>{
      const keys=rows.map(r=>InventoryContract.member(rowToObject_(r)));
      if(new Set(keys).size!==keys.length)throw new Error('Duplicados en BD_BASE, centro '+center);
      const sh=ss.getSheetByName(center);if(sh)validateHeaders_(sh);
    });
    let skipped=0;
    Object.entries(groups).forEach(([center,incoming])=>{
      const sh=ss.getSheetByName(center)||ss.insertSheet(center);ensureColumns_(sh);
      const rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,40).getValues():[];
      const map=new Map(rows.map((r,i)=>[InventoryContract.member(rowToObject_(r)),i]));
      incoming.forEach(row=>{
        const key=InventoryContract.member(rowToObject_(row));
        if(map.has(key)){const i=map.get(key);if(InventoryContract.has(rows[i][COL.Stock_Total-1])){skipped++;return;}
          rows[i]=row;
        }else{map.set(key,rows.length);rows.push(row);}
      });
      if(sh.getMaxRows()<rows.length+1)sh.insertRowsAfter(sh.getMaxRows(),rows.length+1-sh.getMaxRows());
      if(rows.length)sh.getRange(2,1,rows.length,40).setValues(rows);
    });
    SpreadsheetApp.flush();
    SpreadsheetApp.getUi().alert('Maestros actualizados. Filas contadas conservadas: '+skipped);
  }finally{lock.releaseLock();}
}

function originalStock_(p,item){
  const ss=spreadsheet_();let sh=ss.getSheetByName('_INVENTORY_ORIGINAL_STOCK');
  if(!sh){sh=ss.insertSheet('_INVENTORY_ORIGINAL_STOCK');sh.appendRow(['Identity','OriginalStock','Fecha']);sh.hideSheet();}
  const key=hash_(JSON.stringify([p.inventoryId||'',p.center,InventoryContract.member(item)]));
  if(sh.getLastRow()>1){const found=sh.getRange(2,1,sh.getLastRow()-1,1).createTextFinder(key).matchEntireCell(true).useRegularExpression(false).findNext();
    if(found)return sh.getRange(found.getRow(),2).getValue();}
  const original=InventoryContract.number(item.Stock_Sistema,'Stock_Sistema');
  sh.appendRow([key,original,new Date()]);return original;
}
