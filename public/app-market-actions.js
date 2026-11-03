function bindMarketActions(context){
 const {office,admin,units}=context;
 marketCrmActions(office);
 marketFleetActions(office);
 marketUnitActions(admin,units);
 marketReferenceActions(office);
 marketApprovalActions(office);
}
