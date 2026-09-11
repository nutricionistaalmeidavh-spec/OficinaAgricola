import { openDatabase, migrate } from './db.js';
const db = openDatabase();
migrate(db);
db.close();
console.log('Database migrated');
