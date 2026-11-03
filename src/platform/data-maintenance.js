import {transaction} from '../db.js';

// Financial idempotency keys and canonical ledgers are never auto-deleted.
// Delivered events may be pruned only through an explicit retention policy.
export function cleanupOperationalData(db,{now=new Date().toISOString(),deliveredRetentionDays=0}={}){
  const time=new Date(now);
  if(Number.isNaN(time.getTime()))throw new Error('Data de manutenção inválida');
  if(!Number.isSafeInteger(deliveredRetentionDays)||deliveredRetentionDays<0||deliveredRetentionDays>3650)
    throw new Error('Retenção inválida');
  return transaction(db,()=>{
    const sessions=db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(time.toISOString()).changes;
    let deliveredEvents=0;
    if(deliveredRetentionDays>0){
      const cutoff=new Date(time.getTime()-deliveredRetentionDays*86400000).toISOString();
      deliveredEvents=db.prepare('DELETE FROM domain_outbox WHERE delivered_at IS NOT NULL AND delivered_at<?')
        .run(cutoff).changes;
    }
    return {sessions,deliveredEvents};
  });
}
