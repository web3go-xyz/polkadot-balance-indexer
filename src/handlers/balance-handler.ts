import { SubstrateBlock, SubstrateEvent } from '@subql/types';
import { Account } from '../types/models/Account';
import { Transfer } from '../types/models/Transfer';
import { IDGenerator } from '../types/models/IDGenerator';
import { Balance } from "@polkadot/types/interfaces";


const generaterID = "GENERATOR"

const getID = async () => {
  let generator = await IDGenerator.get(generaterID);
  if (generator == null) {
    generator = new IDGenerator(generaterID);
    generator.aID = BigInt(0).valueOf();
    await generator.save();
    logger.info(`first aID is : ${generator.aID}`);
    return generator.aID
  }
  else {
    generator.aID = generator.aID + BigInt(1).valueOf()
    await generator.save()
    logger.info(`new aID is : ${generator.aID}`);
    return generator.aID
  }
}

const _createNewAccount = async (address: string) => {
  const account = new Account(address);
  account.freeBalance = BigInt(0);
  account.reserveBalance = BigInt(0);
  account.totalBalance = BigInt(0);
  account.aid = await getID();
  await account.save();
  return account;
}

export const handleTransfer = async (substrateEvent: SubstrateEvent) => {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;
  const [from, to, balanceChange] = event.data.toJSON() as [string, string, bigint];


  logger.info(`New Transfer happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist
  let fromAccount = await Account.get(from);
  if (!fromAccount) {
    fromAccount = await _createNewAccount(from);
  }
  let toAccount = await Account.get(to);
  if (!toAccount) {
    toAccount = await _createNewAccount(to);
  }

  // Create the new transfer entity
  const transfer = new Transfer(
    `${blockNum}-${createdAt}-${from}-${to}`,
  );
  transfer.blockNumber = blockNum.toBigInt();
  transfer.fromId = from;
  transfer.toId = to;
  transfer.balanceChange = BigInt(balanceChange);
  transfer.aid = await getID();
  // Set the balance for from, to account
  fromAccount.freeBalance = fromAccount.freeBalance - BigInt(balanceChange);
  fromAccount.totalBalance = fromAccount.freeBalance + fromAccount.reserveBalance;
  toAccount.freeBalance = toAccount.freeBalance + BigInt(balanceChange);
  toAccount.totalBalance = toAccount.freeBalance + toAccount.reserveBalance;
  // rescord the snapshot in Transfer entity
  transfer.to_freeBalance = toAccount.freeBalance;
  transfer.to_reserveBalance = toAccount.reserveBalance;
  transfer.to_totalBalance = toAccount.totalBalance;
  transfer.from_freeBalance = fromAccount.freeBalance;
  transfer.from_reserveBalance = fromAccount.reserveBalance;
  transfer.from_totalBalance = fromAccount.totalBalance;
  await toAccount.save();
  await fromAccount.save();
  await transfer.save();
};