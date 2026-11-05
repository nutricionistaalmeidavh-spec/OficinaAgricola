(function(root){
 'use strict';
 // Read-only UI affordances; server-side RBAC remains the authorization source.
 const ALL=['ADMIN','ATENDIMENTO','TECNICO','FINANCEIRO'];
 const SALES=['ADMIN','ATENDIMENTO','FINANCEIRO'];
 const FINANCE=['ADMIN','FINANCEIRO'];
 const ADMIN=['ADMIN'];
 const pages=Object.freeze({
  dashboard:ALL,
  'work-orders':ALL,
  schedule:ALL,
  customers:ALL,
  market:ALL,
  machines:ALL,
  services:ALL,
  inventory:ALL,
  sales:SALES,
  finance:FINANCE,
  fiscal:FINANCE,
  reports:ALL,
  technicians:ALL,
  settings:ADMIN
 });
 const canViewPage=(role,page)=>Boolean(pages[page]?.includes(role));
 root.OficinaRolePermissions=Object.freeze({canViewPage});
})(typeof window!=='undefined'?window:globalThis);
