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
if (typeof module !== 'undefined') module.exports = InventoryContract;
