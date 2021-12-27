import {SubstrateEvent, SubstrateBlock} from "@subql/types";
import {Transfer, Account} from "../types";
import {Balance} from "@polkadot/types/interfaces";

import {
    handleTransfer,
} from '../handlers/balance-handler';


const noop = async () => {};

const eventsMapping = {
  'balances/Transfer': handleTransfer,
};

export async function handleBlock(block: SubstrateBlock): Promise<void> {
  let number = block.block.header.number.toNumber();
  let extrinsics = block.block.extrinsics;
//   for(let i=0;i<extrinsics.length;i++){
//     const { isSigned, meta, method: { args, method, section } } = extrinsics[i];
//   };
}

export async function handleEvent(event: SubstrateEvent): Promise<void> {
  const {
    event: { method, section },
    block: {
      block: { header }
    },
    idx,
    extrinsic
  } = event;

  const eventType = `${section}/${method}`;
  const { method: extMethod, section: extSection } = extrinsic?.extrinsic.method || {};
  const handler = eventsMapping[eventType];
  if (handler) {
    logger.info(
      `
      Event ${eventType} at ${idx} received, block: ${header.number.toNumber()}, extrinsic: ${extSection}/${extMethod}:
      -------------
        ${JSON.stringify(event.toJSON(), null, 2)} ${JSON.stringify(event.toHuman(), null, 2)}
      =============
      `
    );
    await handler(event);
  }
}

// export async function handleTransfer(event: SubstrateEvent): Promise<void> {
//     // Get data from the event
//     // The balances.transfer event has the following payload \[from, to, value\]
//     // logger.info(JSON.stringify(event));
//     const from = event.event.data[0];
//     const to = event.event.data[1];
//     const amount = event.event.data[2];
//     // logger.info(from + '' +  to + '' + amount);
    
//     // ensure that our account entities exist
//     const fromAccount = await Account.get(from.toString());
//     if (!fromAccount) {
//         await new Account(from.toString()).save();
//     }
    
//     const toAccount = await Account.get(to.toString());
//     if (!toAccount) {
//         await new Account(to.toString()).save();
//     }
    
//     // Create the new transfer entity
//     const transfer = new Transfer(
//         `${event.block.block.header.number.toNumber()}-${event.idx}`,
//     );
//     transfer.blockNumber = event.block.block.header.number.toBigInt();
//     transfer.fromId = from.toString();
//     transfer.toId = to.toString();
//     transfer.amount = (amount as Balance).toBigInt();
//     await transfer.save();
// }