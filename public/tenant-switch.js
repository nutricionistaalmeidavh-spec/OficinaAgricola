(function(){
  'use strict';
  const storageKey='oficina:selected-unit';
  let selected=sessionStorage.getItem(storageKey)||'';
  let enabled=false;
  let units=[];
  const getUnitId=()=>enabled?selected:'';
  function headers(existing={}){
    const h={...existing};
    if(enabled&&selected)h['X-Oficina-Unit']=selected;
    return h;
  }
  async function load(){
    const response=await fetch('/api/tenancy/context',{credentials:'same-origin',cache:'no-store'});
    if(response.status===404){enabled=false;return;}
    if(!response.ok)throw new Error('Não foi possível carregar as unidades permitidas');
    const result=await response.json();
    units=result.units||[];
    if(!units.length)throw new Error('Usuário sem unidade autorizada');
    enabled=true;
    if(!units.some(u=>String(u.id)===selected)){
      selected=String(units[0].id);
      sessionStorage.setItem(storageKey,selected);
    }
    for(const [hostId,pickerId,manageId] of [
      ['tenantContainer','tenantSelect','tenantManageBtn'],
      ['mobileTenantContainer','mobileTenantSelect','mobileTenantManageBtn']
    ]){
      const host=document.getElementById(hostId);
      const picker=document.getElementById(pickerId);
      if(!host||!picker)continue;
      host.hidden=false;picker.replaceChildren();
      for(const unit of units){
        const option=document.createElement('option');
        option.value=String(unit.id);
        option.textContent=unit.companyName+' / '+unit.name;
        option.selected=option.value===selected;
        picker.append(option);
      }
      picker.onchange=()=>{
        if(!units.some(u=>String(u.id)===picker.value))return;
        selected=picker.value;sessionStorage.setItem(storageKey,selected);
        // Recreate page data under the new authorized unit.
        location.reload();
      };
      const manage=document.getElementById(manageId);
      if(manage)manage.hidden=!result.platformAdmin&&!units.some(u=>u.role==='ADMIN');
    }
    window.OficinaTenant.enabled=true;
    window.OficinaTenant.units=units;
    window.OficinaTenant.platformAdmin=!!result.platformAdmin;
  }
  window.OficinaTenant={getUnitId,headers,load,enabled:false,units:[],platformAdmin:false};
})();
