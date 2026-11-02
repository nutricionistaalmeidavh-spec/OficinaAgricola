import { openDatabase, migrate } from './db.js';
import { createUser } from './auth.js';
import { seedDefaultChecklists } from './services/operations.js';

export function seed(db,{adminUser=process.env.ADMIN_USER||'admin',adminPassword=process.env.ADMIN_PASSWORD,nodeEnv=process.env.NODE_ENV||'development'}={}){
  migrate(db); seedDefaultChecklists(db);
  if(Number(db.prepare('SELECT COUNT(*) n FROM users').get().n)===0){
    const password=adminPassword || (nodeEnv!=='production'?'Admin@1234':null);
    if(!password) throw new Error('ADMIN_PASSWORD é obrigatório para seed em produção');
    createUser(db,{username:adminUser,password,role:'ADMIN',name:'Administrador'});
    return {adminCreated:true,demoPasswordUsed:!adminPassword};
  }
  return {adminCreated:false,demoPasswordUsed:false};
}

if(import.meta.url===`file://${process.argv[1]}`){const db=openDatabase();const result=seed(db);db.close();console.log(result.demoPasswordUsed?'Seed concluído. DEV: senha padrão Admin@1234; altere antes de uso real.':'Seed concluído.');}
