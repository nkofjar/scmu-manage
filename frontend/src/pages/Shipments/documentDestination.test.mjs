import test from 'node:test';
import assert from 'node:assert/strict';
import {documentDestination} from './documentOwnership.mjs';
test('document destinations follow their owning workflows rather than generic Documents',()=>{
 for(const category of ['POD','DELIVERY_RECEIPT','DRIVER_BON'])assert.equal(documentDestination({category,billId:'a',journeyId:'j'}),'/bl-register/a?tab=driver-bons');
 for(const category of ['PACKING_LIST','RECEIVING_REPORT','PACKING_HEADER'])assert.equal(documentDestination({category,billId:'a',journeyId:'j'}),'/bl-register/a?tab=packing');
 for(const category of ['INVOICE','PAYMENT_PROOF','TAX_INVOICE','PPH23_CERTIFICATE'])assert.equal(documentDestination({category,billId:'a',journeyId:'j'}),'/bl-register/a?tab=costs&documents=1');
 for(const category of ['MANIFEST','FINAL','CUSTOM_OLD'])assert.equal(documentDestination({category,billId:'a',journeyId:'j'}),'/shipments/j?tab=documents');
 assert.equal(documentDestination({category:'CUSTOM_OLD',billId:'a'}),'/bl-register/a?legacyFiles=1');
});
