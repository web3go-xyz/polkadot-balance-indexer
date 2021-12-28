import { SubstrateBlock, SubstrateEvent } from '@subql/types';
import { Account } from '../types/models/Account';
import { Transfer } from '../types/models/Transfer';
import { BalanceSet } from '../types/models/BalanceSet';
import { Deposit } from '../types/models/Deposit';
import { IDGenerator } from '../types/models/IDGenerator';
import { Reserved } from '../types/models/Reserved';
import { Unreserved } from '../types/models/Unreserved';
import { Withdraw } from '../types/models/Withdraw';
import { Slash } from '../types/models/Slash';
import { ReservRepatriated } from '../types/models/ReservRepatriated';
import { AccountInfo } from '@polkadot/types/interfaces/system';

const generaterID = "GENERATOR";

class AccountWrapper {
  account: Account;
  snapShotAtCurrentBlock: boolean;//是否是当前区块的快照
}
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


async function getAccountInfo(address: string): Promise<any> {

  logger.info(`getAccountInfo by addres:${address}`);
  const raw: AccountInfo = await api.query.system.account(address) as unknown as AccountInfo;

  let accountInfo: any = {};
  if (raw) {
    accountInfo = {
      address: address,
      free: raw.data.free.toBigInt(),
      reserved: raw.data.reserved.toBigInt(),
      total: raw.data.free.toBigInt() + raw.data.reserved.toBigInt(),
      snapShotAtCurrentBlock: true
    };
  }
  else {
    accountInfo = {
      address: address,
      free: 0,
      reserved: 0,
      total: 0,
      snapShotAtCurrentBlock: false
    }
  }
  logger.info(`getAccountInfo : ${(accountInfo.address)}--${accountInfo.free}--${accountInfo.reserved}--${accountInfo.total}`);
  return accountInfo;
}

const createNewAccount = async (address: string): Promise<AccountWrapper> => {
  const account = new Account(address);
  let fetchAccountInfo = await getAccountInfo(address);

  account.freeBalance = BigInt(fetchAccountInfo.free);
  account.reserveBalance = BigInt(fetchAccountInfo.reserved);
  account.totalBalance = BigInt(fetchAccountInfo.total);
  account.aid = await getID();
  await account.save();

  let accountWrapper: AccountWrapper = {
    account: account,
    snapShotAtCurrentBlock: fetchAccountInfo.snapShotAtCurrentBlock
  }
  return accountWrapper;
}

//逻辑要调整一下.
//因为在某个高度拿到的账户balance是已经结算好的了, 因此在这个高度上发生的交易等事件, 就不需要重复计算了.

export const handleTransfer = async (substrateEvent: SubstrateEvent) => {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;
  const [from, to, balanceChange] = event.data.toJSON() as [string, string, bigint];


  logger.info(`New Transfer happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist
  let fromAccountSnapshot = false;
  let toAccountSnapshot = false;
  let fromAccount = await Account.get(from);
  if (!fromAccount) {
    let result = await createNewAccount(from);
    fromAccount = result.account;
    fromAccountSnapshot = result.snapShotAtCurrentBlock;

  }
  let toAccount = await Account.get(to);
  if (!toAccount) {
    let result = await createNewAccount(to);
    toAccount = result.account;
    toAccountSnapshot = result.snapShotAtCurrentBlock;
  }

  // Create the new transfer entity
  const transfer = new Transfer(
    `${blockNum}-${event.index}`,
  );
  transfer.blockNumber = blockNum.toBigInt();
  transfer.fromId = from;
  transfer.toId = to;
  transfer.balanceChange = BigInt(balanceChange);
  transfer.aid = await getID();

  // Set the balance for from, to account 
  if (fromAccountSnapshot === false) {
    fromAccount.freeBalance = fromAccount.freeBalance - BigInt(balanceChange);
    fromAccount.totalBalance = fromAccount.freeBalance + fromAccount.reserveBalance;
  }
  if (toAccountSnapshot === false) {
    toAccount.freeBalance = toAccount.freeBalance + BigInt(balanceChange);
    toAccount.totalBalance = toAccount.freeBalance + toAccount.reserveBalance;
  }

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

//“AccountId” ‘s free balance =”Balance1”, reserve balance = “Balance2”
export const handleBalanceSet = async (substrateEvent: SubstrateEvent) => {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;
  const [accountToSet, balance1, balance2] = event.data.toJSON() as [string, bigint, bigint];


  logger.info(`BalanceSet happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist
  let accountSnapshotAtBlock = false;
  let account = await Account.get(accountToSet);
  if (!account) {
    let result = await createNewAccount(accountToSet);
    account = result.account;
    accountSnapshotAtBlock = result.snapShotAtCurrentBlock;
  }

  // Create the new BalanceSet entity
  const balanceSet = new BalanceSet(
    `${blockNum}-${event.index}`,
  );
  balanceSet.blockNumber = blockNum.toBigInt();
  balanceSet.aid = await getID();
  balanceSet.balanceChange = BigInt(balance1) + BigInt(balance2);


  //TODO Research 这里可能old值已经拿不到了
  //save old balance
  balanceSet.freeBalance_old = account.freeBalance;
  balanceSet.reserveBalance_old = account.reserveBalance;
  balanceSet.totalBalance_old = account.totalBalance;

  //set new balance
  balanceSet.freeBalance = BigInt(balance1);
  balanceSet.reserveBalance = BigInt(balance2);
  balanceSet.totalBalance = balanceSet.freeBalance + balanceSet.reserveBalance;
  //set new balance to account
  account.freeBalance = BigInt(balance1);
  account.reserveBalance = BigInt(balance2);
  account.totalBalance = BigInt(balance1) + BigInt(balance2);
  await account.save();
  await balanceSet.save();
};

//“AccountId” ’s free balance + “Balance”
export const handleDeposit = async (substrateEvent: SubstrateEvent) => {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];


  logger.info(`Deposit happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist
  let accountSnapshotAtBlock = false;
  let account = await Account.get(accountToSet);
  if (!account) {
    let result = await createNewAccount(accountToSet);
    account = result.account;
    accountSnapshotAtBlock = result.snapShotAtCurrentBlock;
  }

  // Create the new Deposit entity
  const deposit = new Deposit(
    `${blockNum}-${event.index}`,
  );
  deposit.blockNumber = blockNum.toBigInt();
  deposit.aid = await getID();
  deposit.balanceChange = BigInt(balance);

  if (accountSnapshotAtBlock) {

    //set new balance
    deposit.freeBalance = account.freeBalance;
    deposit.reserveBalance = account.reserveBalance;
    deposit.totalBalance = account.totalBalance;

    //逆向倒推旧值
    //save old balance
    deposit.freeBalance_old = account.freeBalance - BigInt(balance);
    deposit.reserveBalance_old = account.reserveBalance;
    deposit.totalBalance_old = deposit.freeBalance_old + deposit.reserveBalance_old;

  }
  else {
    //save old balance
    deposit.freeBalance_old = account.freeBalance;
    deposit.reserveBalance_old = account.reserveBalance;
    deposit.totalBalance_old = account.totalBalance;

    //正向计算新值
    //set new balance
    deposit.freeBalance = deposit.freeBalance_old + BigInt(balance);
    deposit.reserveBalance = deposit.reserveBalance_old;
    deposit.totalBalance = deposit.freeBalance + deposit.reserveBalance;

    //set new balance to account
    account.reserveBalance = deposit.reserveBalance;
    account.freeBalance = deposit.freeBalance;
    account.totalBalance = deposit.totalBalance;
  }


  await account.save();
  await deposit.save();
};

//“AccountId” ‘s free balance - “Balance”,“AccountId” ‘s reserve balance + “Balance”
export const handleReserved = async (substrateEvent: SubstrateEvent) => {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];


  logger.info(`Reserved happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist
  let accountSnapshotAtBlock = false;
  let account = await Account.get(accountToSet);
  if (!account) {
    let result = await createNewAccount(accountToSet);
    account = result.account;
    accountSnapshotAtBlock = result.snapShotAtCurrentBlock;
  }

  // Create the new Reserved entity
  const reserved = new Reserved(
    `${blockNum}-${event.index}`,
  );
  reserved.blockNumber = blockNum.toBigInt();
  reserved.aid = await getID();
  reserved.balanceChange = BigInt(balance);

  if (accountSnapshotAtBlock) {
    //逆向倒推旧值
    //set new balance
    reserved.freeBalance = account.freeBalance;
    reserved.reserveBalance = account.reserveBalance;
    reserved.totalBalance = account.totalBalance;

    //save old balance
    reserved.freeBalance_old = reserved.freeBalance + BigInt(balance);
    reserved.reserveBalance_old = reserved.reserveBalance - BigInt(balance);
    reserved.totalBalance_old = reserved.freeBalance_old + reserved.reserveBalance_old;
  }
  else {
    //正向计算新值
    //save old balance
    reserved.freeBalance_old = account.freeBalance;
    reserved.reserveBalance_old = account.reserveBalance;
    reserved.totalBalance_old = account.totalBalance;
    //set new balance
    reserved.freeBalance = reserved.freeBalance_old - BigInt(balance);
    reserved.reserveBalance = reserved.reserveBalance_old + BigInt(balance);
    reserved.totalBalance = reserved.freeBalance + reserved.reserveBalance;
    //set new balance to account
    account.freeBalance = reserved.freeBalance;
    account.reserveBalance = reserved.reserveBalance;
    account.totalBalance = reserved.totalBalance;
  }


  await account.save();
  await reserved.save();
};

//“AccountId” ‘s free balance + “Balance”, “AccountId” ‘s reserve balance - “Balance”
export const handleUnreserved = async (substrateEvent: SubstrateEvent) => {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];


  logger.info(`Unreserved happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist
  let accountSnapshotAtBlock = false;
  let account = await Account.get(accountToSet);
  if (!account) {
    let result = await createNewAccount(accountToSet);
    account = result.account;
    accountSnapshotAtBlock = result.snapShotAtCurrentBlock;
  }

  // Create the new Reserved entity
  const unreserved = new Unreserved(
    `${blockNum}-${event.index}`,
  );
  unreserved.blockNumber = blockNum.toBigInt();
  unreserved.aid = await getID();
  unreserved.balanceChange = BigInt(balance);

  if (accountSnapshotAtBlock) {
    //逆向倒推旧值
    //set new balance
    unreserved.freeBalance = account.freeBalance;
    unreserved.reserveBalance = account.reserveBalance;
    unreserved.totalBalance = account.totalBalance;

    //save old balance
    unreserved.freeBalance_old = unreserved.freeBalance - BigInt(balance);
    unreserved.reserveBalance_old = unreserved.reserveBalance + BigInt(balance);
    unreserved.totalBalance_old = unreserved.freeBalance_old + unreserved.reserveBalance_old;

  }
  else {
    //正向计算新值
    //save old balance
    unreserved.freeBalance_old = account.freeBalance;
    unreserved.reserveBalance_old = account.reserveBalance;
    unreserved.totalBalance_old = account.totalBalance;
    //set new balance
    unreserved.freeBalance = unreserved.freeBalance_old + BigInt(balance);
    unreserved.reserveBalance = unreserved.reserveBalance_old - BigInt(balance);
    unreserved.totalBalance = unreserved.freeBalance + unreserved.reserveBalance;
    //set new balance to account
    account.freeBalance = unreserved.freeBalance;
    account.reserveBalance = unreserved.reserveBalance;
    account.totalBalance = unreserved.totalBalance;
  }



  await account.save();
  await unreserved.save();
};


//“AccountId” ‘s free balance - “Balance”
export const handleWithdraw = async (substrateEvent: SubstrateEvent) => {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];


  logger.info(`Withdraw happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist
  let accountSnapshotAtBlock = false;
  let account = await Account.get(accountToSet);
  if (!account) {
    let result = await createNewAccount(accountToSet);
    account = result.account;
    accountSnapshotAtBlock = result.snapShotAtCurrentBlock;
  }

  // Create the new Withdraw entity
  const withdraw = new Withdraw(
    `${blockNum}-${event.index}`,
  );
  withdraw.blockNumber = blockNum.toBigInt();
  withdraw.aid = await getID();
  withdraw.balanceChange = BigInt(balance);

  if (accountSnapshotAtBlock) {
    //逆向倒推旧值

    //set new balance
    withdraw.freeBalance = account.freeBalance;
    withdraw.reserveBalance = account.reserveBalance;
    withdraw.totalBalance = account.totalBalance;

    //save old balance
    withdraw.freeBalance_old = withdraw.freeBalance + BigInt(balance);
    withdraw.reserveBalance_old = withdraw.reserveBalance;
    withdraw.totalBalance_old = withdraw.freeBalance_old + withdraw.reserveBalance_old;

  }
  else {
    //正向计算新值

    //save old balance
    withdraw.freeBalance_old = account.freeBalance;
    withdraw.reserveBalance_old = account.reserveBalance;
    withdraw.totalBalance_old = account.totalBalance;
    //set new balance
    withdraw.freeBalance = withdraw.freeBalance_old - BigInt(balance);
    withdraw.reserveBalance = withdraw.reserveBalance_old;
    withdraw.totalBalance = withdraw.freeBalance + withdraw.reserveBalance;
    //set new balance to account
    account.reserveBalance = withdraw.reserveBalance;
    account.freeBalance = withdraw.freeBalance;
    account.totalBalance = withdraw.totalBalance;

  }

  await account.save();
  await withdraw.save();
};

//“AccountId” ‘s total balance - “Balance”
//(hard to determine if the slash happens on free/reserve)
//If it is called through internal method “slash”, then it will prefer free balance first but potential slash reserve if free is not sufficient.
//If it is called through internal method “slash_reserved”, then it will slash reserve only.
export const handleSlash = async (substrateEvent: SubstrateEvent) => {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];


  logger.info(`Slash happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist
  let accountSnapshotAtBlock = false;
  let account = await Account.get(accountToSet);
  if (!account) {
    let result = await createNewAccount(accountToSet);
    account = result.account;
    accountSnapshotAtBlock = result.snapShotAtCurrentBlock;
  }

  // Create the new Withdraw entity
  const slash = new Slash(
    `${blockNum}-${event.index}`,
  );
  slash.blockNumber = blockNum.toBigInt();
  slash.aid = await getID();
  slash.balanceChange = BigInt(balance);

  if (accountSnapshotAtBlock) {
    //逆向倒推旧值
    //set new balance
    slash.totalBalance = account.totalBalance;

    //save old balance
    slash.freeBalance_old = account.freeBalance;
    slash.reserveBalance_old = account.reserveBalance;
    slash.totalBalance_old = slash.freeBalance_old + slash.reserveBalance_old + BigInt(balance);

  }
  else {
    //正向计算新值
    //save old balance
    slash.freeBalance_old = account.freeBalance;
    slash.reserveBalance_old = account.reserveBalance;
    slash.totalBalance_old = account.totalBalance;
    //set new balance
    slash.totalBalance = slash.freeBalance_old + slash.reserveBalance_old - BigInt(balance);
    //set new balance to account
    account.totalBalance = slash.totalBalance;
  }

  await account.save();
  await slash.save();
};


/* -ReserveRepatriated(AccountId, AccountId, Balance, Status) 
    AccountId: sender  
    AccountId: receiver
    Balance: amount of sender's reserve being transfered
    Status: Indicating the amount is added to receiver's reserve part or free part of balance.
    “AccountId1” ‘s reserve balance - “Balance”
    “AccountId2” ‘s “Status” balance + “Balance” (”Status” indicator of free/reserve part) */

export const handleReservRepatriated = async (substrateEvent: SubstrateEvent) => {
  const { event, block } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: blockNum } = rawBlock.header;
  const [sender, receiver, balance, status] = event.data.toJSON() as [string, string, bigint, string];


  logger.info(`Repatraiated happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist
  let senderAccountSnapshotAtBlock = false;
  let receiverAccountSnapshotAtBlock = false;
  let senderAccount = await Account.get(sender);
  if (!senderAccount) {
    let result = await createNewAccount(sender);
    senderAccount = result.account;
    senderAccountSnapshotAtBlock = result.snapShotAtCurrentBlock;
  }
  let receiverAccount = await Account.get(receiver);
  if (!receiverAccount) {
    let result = await createNewAccount(receiver);
    receiverAccount = result.account;
    receiverAccountSnapshotAtBlock = result.snapShotAtCurrentBlock;
  }

  // Create the new Reserved entity
  const reservRepatriated = new ReservRepatriated(
    `${blockNum}-${event.index}`,
  );
  reservRepatriated.blockNumber = blockNum.toBigInt();
  reservRepatriated.aid = await getID();
  reservRepatriated.balanceChange = BigInt(balance);

  if (senderAccountSnapshotAtBlock) {
    //逆向倒推旧值
    //save old balance
    reservRepatriated.from_freeBalance = senderAccount.freeBalance;
    reservRepatriated.from_reserveBalance = senderAccount.reserveBalance;
    reservRepatriated.from_totalBalance = senderAccount.totalBalance;

    //set new balance
    reservRepatriated.from_freeBalance_old = reservRepatriated.from_freeBalance;
    reservRepatriated.from_reserveBalance_old = reservRepatriated.from_reserveBalance + BigInt(balance);
    reservRepatriated.from_totalBalance_old = reservRepatriated.from_freeBalance_old + reservRepatriated.from_reserveBalance_old;

  } else {
    //正向计算新值
    //save old balance
    reservRepatriated.from_freeBalance_old = senderAccount.freeBalance;
    reservRepatriated.from_reserveBalance_old = senderAccount.reserveBalance;
    reservRepatriated.from_totalBalance_old = senderAccount.totalBalance;

    //set new balance
    reservRepatriated.from_freeBalance = reservRepatriated.from_freeBalance_old;
    reservRepatriated.from_reserveBalance = reservRepatriated.from_reserveBalance_old - BigInt(balance);
    reservRepatriated.from_totalBalance = reservRepatriated.from_freeBalance + reservRepatriated.from_reserveBalance;

    //set new balance to account
    senderAccount.freeBalance = reservRepatriated.from_freeBalance;
    senderAccount.reserveBalance = reservRepatriated.from_reserveBalance;
    senderAccount.totalBalance = reservRepatriated.from_totalBalance;
  }

  if (receiverAccountSnapshotAtBlock) {
    //逆向倒推旧值

    //save old balance
    reservRepatriated.to_freeBalance = receiverAccount.freeBalance;
    reservRepatriated.to_reserveBalance = receiverAccount.reserveBalance;
    reservRepatriated.to_totalBalance = receiverAccount.totalBalance;
    //set new balance
    if (status === "Free") { //the amount is added to receiver's free part of balance
      reservRepatriated.to_freeBalance_old = reservRepatriated.to_freeBalance - BigInt(balance);
      reservRepatriated.to_reserveBalance_old = reservRepatriated.to_reserveBalance;
    }
    else {
      //the amount is added to receiver's reserve part 
      reservRepatriated.to_freeBalance_old = reservRepatriated.to_freeBalance;
      reservRepatriated.to_reserveBalance_old = reservRepatriated.to_reserveBalance - BigInt(balance);
    }
    reservRepatriated.to_totalBalance_old = reservRepatriated.to_freeBalance_old + reservRepatriated.to_reserveBalance_old;

  }
  else {
    //正向计算新值

    //save old balance
    reservRepatriated.to_freeBalance_old = receiverAccount.freeBalance;
    reservRepatriated.to_reserveBalance_old = receiverAccount.reserveBalance;
    reservRepatriated.to_totalBalance_old = receiverAccount.totalBalance;
    //set new balance
    if (status === "Free") { //the amount is added to receiver's free part of balance
      reservRepatriated.to_freeBalance = reservRepatriated.to_freeBalance_old + BigInt(balance);
      reservRepatriated.to_reserveBalance = reservRepatriated.to_reserveBalance_old;
    }
    else {//the amount is added to receiver's reserve part 
      reservRepatriated.to_freeBalance = reservRepatriated.to_freeBalance_old;
      reservRepatriated.to_reserveBalance = reservRepatriated.to_reserveBalance_old + BigInt(balance);
    }
    reservRepatriated.to_totalBalance = reservRepatriated.to_freeBalance + reservRepatriated.to_reserveBalance;
    //set new balance to account
    receiverAccount.freeBalance = reservRepatriated.to_freeBalance;
    receiverAccount.reserveBalance = reservRepatriated.to_reserveBalance;
    receiverAccount.totalBalance = reservRepatriated.to_totalBalance;
  }

  await senderAccount.save();
  await receiverAccount.save();
  await reservRepatriated.save();
};