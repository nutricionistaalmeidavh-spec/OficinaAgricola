import { openDatabase, migrate } from './db.js';
import { createUser } from './auth.js';
import { seedDefaultChecklists } from './services/operations.js';

export function seed(db,{adminUser=process.env.ADMIN_USER||'admin',adminPassword=process.env.ADMIN_PASSWORD,nodeEnv=process.env.NODE_ENV||'development'}={}){
  migrate(db); seedDefaultChecklists(db);
  if(Number(db.prepare('SELECT COUNT(*) n FROM users').get().n)===0){
    // Install clean: require an explicitly configured password or interactive local onboarding.
    // Never create a demo user implicitly, regardless of NODE_ENV.
    if(!adminPassword)return {adminCreated:false,demoPasswordUsed:false,setupRequired:true};
    createUser(db,{username:adminUser,password:adminPassword,role:'ADMIN',name:'Administrador'});
    return {adminCreated:true,demoPasswordUsed:false,setupRequired:false};
  }
  return {adminCreated:false,demoPasswordUsed:false,setupRequired:false};
}

if(import.meta.url===`file://${process.argv[1]}`){const db=openDatabase();const result=seed(db);db.close();console.log(result.setupRequired?'Banco criado. Abra o aplicativo na máquina principal para cadastrar o primeiro administrador.':'Seed concluído.');}
