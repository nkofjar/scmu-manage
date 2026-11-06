const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../src/services/driverTrips'),{fixture}=require('./driverTrips.test');
test('Jayapura period turns at local midnight and report validates leap-day date-only boundaries',async()=>{
 assert.equal(service.period({},new Date('2026-10-31T14:59:59Z')),'2026-10');assert.equal(service.period({},new Date('2026-10-31T15:00:00Z')),'2026-11');
 const f=fixture(),w=f.rows[0].data.driverOperations.works[0];f.rows.splice(1);f.rows[0].data.driverOperations.works=['2024-02-01','2024-02-29','2024-03-01','2024-02-30','2023-02-29','2024-02-29T00:00:00Z'].map((receivedDate,i)=>({...w,id:'w'+i,receivedDate}));
 const before=JSON.stringify(f.rows),result=await service.list(f.tx,{month:'2024-02'});assert.deepEqual(result.data.map(w=>w.receivedDate),['2024-02-01','2024-02-29']);assert.equal(JSON.stringify(f.rows),before);
 f.rows[0].data.driverOperations.works.push({...w,id:'w1',receivedDate:'2024-02-29',billIds:['a','shared'],evidenceFileIds:['proof','other']});assert.equal((await service.list(f.tx,{month:'2024-02'})).total,2);
});
