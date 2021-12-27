import { SubstrateBlock, SubstrateEvent } from '@subql/types';
import { Account } from '../types/models/Account';
import { Transfer } from '../types/models/Transfer';
import { IDGenerator } from '../types/models/IDGenerator';


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

  // logger.info(`New Transfer happened!: ${JSON.stringify(event)}`);
  const [from,to,balanceChange] = event.data.toJSON() as [string, string, bigint];

  // const {event: {data: [blockNumber,roundindex,collators,balance]}} = substrateEvent;
  logger.info(`New Transfer happened!: ${JSON.stringify(event)}`);
};