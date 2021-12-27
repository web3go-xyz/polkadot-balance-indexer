import { SubstrateBlock, SubstrateEvent } from '@subql/types';
import { Account } from '../types/models/Account';
import { Transfer } from '../types/models/Transfer';
import { IDGenerator } from '../types/models/IDGenerator';
import {Balance} from "@polkadot/types/interfaces";


const generaterID = "GENERATOR"

const getID = async() => {
  let generator =  await IDGenerator.get(generaterID);
  if (generator == null) {
    generator =  new IDGenerator(generaterID);
    generator.aID = BigInt(0).valueOf();
    await generator.save();
    logger.info(`first aID is : ${generator.aID}`);
    return generator.aID
  }
  else{
    generator.aID =  generator.aID + BigInt(1).valueOf()
    await generator.save()
    logger.info(`new aID is : ${generator.aID}`);
    return generator.aID
  }
}

export const handleTransfer = async (substrateEvent: SubstrateEvent) => {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;
  const [from,to,balanceChange] = event.data.toJSON() as [string, string, bigint];


  logger.info(`New Transfer happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist
  const fromAccount = await Account.get(from);
  if (!fromAccount) {
    await new Account(from).save();
  }  
  const toAccount = await Account.get(to.toString());
  if (!toAccount) {
    await new Account(to).save();
  }
    
  // Create the new transfer entity
  const transfer = new Transfer(
        `${blockNum}-${event.}`,
    );
    transfer.blockNumber = blockNum.toBigInt();
    transfer.fromId = from;
    transfer.toId = to;
    transfer.balanceChange = balanceChange;
    await transfer.save();
};