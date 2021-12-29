import { SubstrateEvent, SubstrateBlock } from "@subql/types";
import { Transfer } from '../types/models/Transfer';
import { BalanceSet } from '../types/models/BalanceSet';
import { Deposit } from '../types/models/Deposit';
import { IDGenerator } from '../types/models/IDGenerator';
import { Reserved } from '../types/models/Reserved';
import { Unreserved } from '../types/models/Unreserved';
import { Withdraw } from '../types/models/Withdraw';
import { Slash } from '../types/models/Slash';
import { ReservRepatriated } from '../types/models/ReservRepatriated';
import { AccountInfo, EventRecord } from '@polkadot/types/interfaces/system';
import { Account, AccountSnapshot, Endowed } from "../types";

class AccountInfoAtBlock {
  accountId: string;
  freeBalance: bigint;
  reserveBalance: bigint;
  totalBalance: bigint;
  snapshotAtBlock: bigint;
}
export async function handleBlock(block: SubstrateBlock): Promise<void> {

  let blockNumber = block.block.header.number.toBigInt();

  let events = block.events;
  let accounts4snapshot: string[] = [];
  for (let i = 0; i < events.length; i++) {
    let event = events[i];
    const {
      event: { method, section, index }
    } = event;

    if (section === 'balances') {
      const eventType = `${section}/${method}`;
      logger.info(
        `
        Block: ${blockNumber}, Event ${eventType} :
        -------------
          ${JSON.stringify(event.toJSON(), null, 1)}  
        =============
        `
      );

      let accounts: string[] = [];
      switch (method) {
        case 'Endowed':
          accounts = await handleEndowed(block, event);
          break;
        case 'Transfer':
          accounts = await handleTransfer(block, event);
          break;
        case 'BalanceSet':
          accounts = await handleBalanceSet(block, event);
          break;
        case 'Deposit':
          accounts = await handleDeposit(block, event);
          break;
        case 'Reserved':
          accounts = await handleReserved(block, event);
          break;
        case 'Withdraw':
          accounts = await handleWithdraw(block, event);
          break;
        case 'Unreserved':
          accounts = await handleUnreserved(block, event);
          break;
        case 'Slash':
          accounts = await handleSlash(block, event);
          break;
        case 'ReservRepatriated':
          accounts = await handleReservRepatriated(block, event);
          break;
        default:
          break;
      }

      for (const a of accounts) {
        if (accounts4snapshot.length > 0 && accounts4snapshot.indexOf(a) > -1) {
          continue;
        }
        accounts4snapshot.push(a);
      }
    }
  };

  if (accounts4snapshot && accounts4snapshot.length > 0) {
    await taskAccountSnapshot(blockNumber, accounts4snapshot);
  }
}
async function taskAccountSnapshot(blockNumber: bigint, accounts4snapshot: string[]) {

  for (const accountId of accounts4snapshot) {
    let accountInfo: AccountInfoAtBlock = await getAccountInfoAtBlockNumber(accountId, blockNumber);
    let id = `${blockNumber.toString()}-${accountId}`;
    let snapshotRecords = await AccountSnapshot.get(id);

    if (!snapshotRecords) {
      let newSnapshot: AccountSnapshot = AccountSnapshot.create({
        id: id,
        accountId: accountId,
        snapshotAtBlock: accountInfo.snapshotAtBlock,
        freeBalance: accountInfo.freeBalance,
        reserveBalance: accountInfo.reserveBalance,
        totalBalance: accountInfo.totalBalance,

      });
      await newSnapshot.save();
    }

    let accountRecord = await Account.get(accountId);
    if (!accountRecord) {
      accountRecord = Account.create({
        id: accountId,
        freeBalance: accountInfo.freeBalance,
        reserveBalance: accountInfo.reserveBalance,
        totalBalance: accountInfo.totalBalance,
        aid: await getID()
      });
      await accountRecord.save();
    }
    else {
      accountRecord.freeBalance = accountInfo.freeBalance;
      accountRecord.reserveBalance = accountInfo.reserveBalance;
      accountRecord.totalBalance = accountInfo.totalBalance;
      await accountRecord.save();
    }
  }

}
async function getAccountInfoAtBlockNumber(accountId: string, blockNumber: bigint): Promise<AccountInfoAtBlock> {

  logger.info(`getAccountInfo at ${blockNumber} by addres:${accountId}`);
  const raw: AccountInfo = await api.query.system.account(accountId) as unknown as AccountInfo;

  let accountInfo: AccountInfoAtBlock;
  if (raw) {
    accountInfo = {
      accountId: accountId,
      freeBalance: raw.data.free.toBigInt(),
      reserveBalance: raw.data.reserved.toBigInt(),
      totalBalance: raw.data.free.toBigInt() + raw.data.reserved.toBigInt(),
      snapshotAtBlock: blockNumber
    };
  }
  else {
    accountInfo = {
      accountId: accountId,
      freeBalance: BigInt(0),
      reserveBalance: BigInt(0),
      totalBalance: BigInt(0),
      snapshotAtBlock: blockNumber
    }
  }
  logger.info(`getAccountInfo at ${blockNumber} : ${(accountInfo.accountId)}--${accountInfo.freeBalance}--${accountInfo.reserveBalance}--${accountInfo.totalBalance}`);
  return accountInfo;
}

export async function handleEvent(event: SubstrateEvent): Promise<void> {

}

const generaterID = "GENERATOR";


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

async function handleEndowed(block: SubstrateBlock, substrateEvent: EventRecord): Promise<string[]> {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountId, balanceChange] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`New Endowed happened!: ${JSON.stringify(event)}`);

  let newEndowed = await Endowed.create({
    id: accountId,
    accountId: accountId,
    freeBalance: BigInt(balanceChange),
    reserveBalance: BigInt(0),
    totalBalance: BigInt(balanceChange),
    blockNumber: blockNum,
    aid: await getID(),
  });
  await newEndowed.save();

  return [accountId];
}

export const handleTransfer = async (block: SubstrateBlock, substrateEvent: EventRecord): Promise<string[]> => {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [from, to, balanceChange] = event.data.toJSON() as [string, string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`New Transfer happened!: ${JSON.stringify(event)}`);

  // Create the new transfer entity
  const transfer = new Transfer(
    `${blockNum}-${event.index}`,
  );
  transfer.blockNumber = blockNum;
  transfer.fromAccountId = from;
  transfer.toAccountId = to;
  transfer.balanceChange = BigInt(balanceChange);
  transfer.aid = await getID();

  await transfer.save();

  return [from, to];
};

//“AccountId” ‘s free balance =”Balance1”, reserve balance = “Balance2”
export const handleBalanceSet = async (block: SubstrateBlock, substrateEvent: EventRecord): Promise<string[]> => {
  const { event, } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance1, balance2] = event.data.toJSON() as [string, bigint, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`BalanceSet happened!: ${JSON.stringify(event)}`);

  // Create the new BalanceSet entity
  const balanceSet = new BalanceSet(
    `${blockNum}-${event.index}`,
  );
  balanceSet.accountId = accountToSet;
  balanceSet.blockNumber = blockNum;
  balanceSet.aid = await getID();
  balanceSet.balanceChange = BigInt(balance1) + BigInt(balance2);
  await balanceSet.save();
  return [accountToSet];
};

//“AccountId” ’s free balance + “Balance”
export const handleDeposit = async (block: SubstrateBlock, substrateEvent: EventRecord): Promise<string[]> => {
  const { event, } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();


  logger.info(`Deposit happened!: ${JSON.stringify(event)}`);



  // Create the new Deposit entity
  const deposit = new Deposit(
    `${blockNum}-${event.index}`,
  );
  deposit.accountId = accountToSet;
  deposit.blockNumber = blockNum;
  deposit.aid = await getID();
  deposit.balanceChange = BigInt(balance);

  await deposit.save();
  return [accountToSet];
};

//“AccountId” ‘s free balance - “Balance”,“AccountId” ‘s reserve balance + “Balance”
export const handleReserved = async (block: SubstrateBlock, substrateEvent: EventRecord): Promise<string[]> => {
  const { event, } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();


  logger.info(`Reserved happened!: ${JSON.stringify(event)}`);


  // Create the new Reserved entity
  const reserved = new Reserved(
    `${blockNum}-${event.index}`,
  );
  reserved.accountId = accountToSet;
  reserved.blockNumber = blockNum;
  reserved.aid = await getID();
  reserved.balanceChange = BigInt(balance);
  await reserved.save();

  return [accountToSet];
};

//“AccountId” ‘s free balance + “Balance”, “AccountId” ‘s reserve balance - “Balance”
export const handleUnreserved = async (block: SubstrateBlock, substrateEvent: EventRecord): Promise<string[]> => {
  const { event, } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`Unreserved happened!: ${JSON.stringify(event)}`);


  // Create the new Reserved entity
  const unreserved = new Unreserved(
    `${blockNum}-${event.index}`,
  );
  unreserved.accountId = accountToSet;
  unreserved.blockNumber = blockNum;
  unreserved.aid = await getID();
  unreserved.balanceChange = BigInt(balance);

  await unreserved.save();

  return [accountToSet];
};


//“AccountId” ‘s free balance - “Balance”
export const handleWithdraw = async (block: SubstrateBlock, substrateEvent: EventRecord): Promise<string[]> => {
  const { event, } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`Withdraw happened!: ${JSON.stringify(event)}`);



  // Create the new Withdraw entity
  const withdraw = new Withdraw(
    `${blockNum}-${event.index}`,
  );
  withdraw.accountId = accountToSet;
  withdraw.blockNumber = blockNum;
  withdraw.aid = await getID();
  withdraw.balanceChange = BigInt(balance);



  await withdraw.save();

  return [accountToSet];
};

//“AccountId” ‘s total balance - “Balance”
//(hard to determine if the slash happens on free/reserve)
//If it is called through internal method “slash”, then it will prefer free balance first but potential slash reserve if free is not sufficient.
//If it is called through internal method “slash_reserved”, then it will slash reserve only.
export const handleSlash = async (block: SubstrateBlock, substrateEvent: EventRecord): Promise<string[]> => {
  const { event, } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`Slash happened!: ${JSON.stringify(event)}`);


  // Create the new Withdraw entity
  const slash = new Slash(
    `${blockNum}-${event.index}`,
  );
  slash.accountId = accountToSet;
  slash.blockNumber = blockNum;
  slash.aid = await getID();
  slash.balanceChange = BigInt(balance);

  await slash.save();

  return [accountToSet];
};


/* -ReserveRepatriated(AccountId, AccountId, Balance, Status) 
    AccountId: sender  
    AccountId: receiver
    Balance: amount of sender's reserve being transfered
    Status: Indicating the amount is added to receiver's reserve part or free part of balance.
    “AccountId1” ‘s reserve balance - “Balance”
    “AccountId2” ‘s “Status” balance + “Balance” (”Status” indicator of free/reserve part) */

export const handleReservRepatriated = async (block: SubstrateBlock, substrateEvent: EventRecord): Promise<string[]> => {
  const { event, } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [sender, receiver, balance, status] = event.data.toJSON() as [string, string, bigint, string];
  let blockNum = bn.toBigInt();

  logger.info(`Repatraiated happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist


  // Create the new Reserved entity
  const reservRepatriated = new ReservRepatriated(
    `${blockNum}-${event.index}`,
  );

  reservRepatriated.fromAccountId = sender;
  reservRepatriated.toAccountId = receiver;
  reservRepatriated.blockNumber = blockNum;
  reservRepatriated.aid = await getID();
  reservRepatriated.balanceChange = BigInt(balance);

  await reservRepatriated.save();

  return [sender, receiver];
};

