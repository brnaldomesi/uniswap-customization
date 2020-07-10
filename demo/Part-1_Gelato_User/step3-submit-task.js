// running `npx buidler test` automatically makes use of buidler-waffle plugin
// => only dependency we need is "chai"
import { expect } from "chai";

// We require the Buidler Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
// When running the script with `buidler run <script>` you'll find the Buidler
// Runtime Environment's members available in the global scope.
import bre from "@nomiclabs/buidler";

describe("Gelato-Kyber Demo Part 1: Step 3 => submit Task via UserProxy", function () {
  // No timeout for Mocha due to Rinkeby mining latency
  this.timeout(0);

  const CREATE_2_SALT = 42069; // for create2 and address prediction
  const gelatoUserProxyFactorAddress =
    bre.network.config.deployments.GelatoUserProxyFactory;

  // We use the already deployed instance of ConditionTimeStateful
  const conditionTimeStatefulAddress =
    bre.network.config.deployments.ConditionTimeStateful;

  const DAI = bre.network.config.addressBook.erc20.DAI;
  const DAI_AMOUNT_PER_TRADE = utils.parseUnits("1", 18);
  const KNC = bre.network.config.addressBook.erc20.KNC;

  // 3) We use the already deployed instance of ActionKyberTrade
  const actionKyberTradeAddress =
    bre.network.config.deployments.ActionKyberTrade;

  const defaultExecutor = bre.network.config.addressBook.gelatoExecutor.default;
  const TWO_MINUTES = 120; // seconds

  const estimatedGasPerExecution = ethers.utils.bigNumberify("500000"); // Limits the required balance of the User on Gelato to be 500.000 * GelatoGasPrice for every execution and not the default 8M

  // We use our User Wallet. Per our config this wallet is at the accounts index 0
  // and hence will be used by default for all transactions we send.
  let myUserAddress;

  // 1) We use the already deployed instance of GelatoUserProxyFactory
  let gelatoUserProxyFactory;

  // 2) We will deploy a GelatoUserProxy using the Factory, or if we already deployed
  //  one, we will use that one.
  let proxyIsDeployedAlready;
  let myUserProxyAddress;
  let myUserProxy;

  // --> Step 2: Submit your Task to Gelato via your GelatoUserProxy constants & vars

  let conditionTimeStateful; // contract instance
  let conditionEvery2minutes; // gelato Condition obj

  let actionKyberTrade; // contract instance
  let actionTradeKyber; // gelato Action obj

  // 4) The last Action updates the ConditionTimeStateful with the time of the last trade
  let actionUpdateConditionTime; // gelato Action obj

  // All these variables and constants will be used to create our Gelato Task object:
  let taskTradeOnKyber;

  // Current Gelato Gas Price
  let currentGelatoGasPrice;

  // --> Step 3: Submit your Task to Gelato via your GelatoUserProxy
  before(async function () {
    // We get our User Wallet from the Buidler Runtime Env
    const myUserWallet = await bre.getUserWallet();
    myUserAddress = await myUserWallet.getAddress();

    // --> Step 1: Deploy your GelatoUserProxy
    gelatoUserProxyFactory = await ethers.getContractAt(
      "IGelatoUserProxyFactory",
      gelatoUserProxyFactorAddress
    );

    currentGelatoGasPrice = await bre.run("fetchGelatoGasPrice");

    // 2) We expect our Proxy to have been created using the Factory's create2 method,
    //  in Demo Part 2 Step 1, which allows us to already predict
    //  the myUserProxyAddress now, by using the same SALT.
    //  Make sure we have created the Proxy already.
    myUserProxyAddress = await gelatoUserProxyFactory.predictProxyAddress(
      myUserAddress,
      CREATE_2_SALT
    );
    proxyIsDeployedAlready = await gelatoUserProxyFactory.isGelatoUserProxy(
      myUserProxyAddress
    );
    if (proxyIsDeployedAlready) {
      myUserProxy = await ethers.getContractAt(
        "GelatoUserProxy",
        myUserProxyAddress
      );
    } else {
      console.log(
        "❌ No GelatoUserProxy deployed. Complete Part2 Step 1 first by running `yarn create-userproxy`\n"
      );
      process.exit(1);
    }

    // --> Step 2: Submit your Task to Gelato via your GelatoUserProxy
    // For this we create a specific Gelato object called a Task
    // The Task consists of a a special GelatoCondition and GelatoAction object.

    // 1) Instantiate the Condition obj of the Task
    //  a) We instantiate ConditionTimeStateful contract to get the Data for the condition
    conditionTimeStateful = await ethers.getContractAt(
      "ConditionTimeStateful",
      conditionTimeStatefulAddress
    );
    //  b) We instantiate the condition obj
    conditionEvery2minutes = new Condition({
      inst: conditionTimeStatefulAddress,
      data: await conditionTimeStateful.getConditionData(myUserProxyAddress),
    });

    // 2) We instantiate the Actions objects that belong to the Task

    //  2.1a) We instantiate ActionKyberTrade contract to get the Data for the Action
    actionKyberTrade = await ethers.getContractAt(
      "ActionKyberTrade",
      actionKyberTradeAddress
    );
    //  2.1b) We instantiate the ActionKyberTrade obj
    actionTradeKyber = new Action({
      addr: actionKyberTradeAddress,
      data: await actionKyberTrade.getActionData(
        myUserAddress, // origin
        DAI, // sendToken
        DAI_AMOUNT_PER_TRADE, // sendAmount (1 DAI)
        KNC, // receiveToken
        myUserAddress // receiver
      ),
      operation: Operation.Delegatecall, // This Action must be executed via the UserProxy
      dataFlow: DataFlow.None, // Expects DAI sell amount after fee from actionFeeHandler
      termsOkCheck: true, // Some sanity checks have to pass before Execution is granted
    });

    //  2.2a) We instantiate the Action obj that updates the ConditionTimeStateful
    //   with the time of the last automated trade.
    actionUpdateConditionTime = new Action({
      addr: conditionTimeStatefulAddress,
      data: await bre.run("abi-encode-withselector", {
        contractname: "ConditionTimeStateful",
        functionname: "setRefTime",
        inputs: [TWO_MINUTES /* _timeDelta */, 0],
      }),
      operation: Operation.Call, // This Action must be called from the UserProxy
    });

    // This is all the info we need to submit this task to Gelato
    taskTradeOnKyber = new Task({
      // All the conditions have to be met
      conditions: [conditionEvery2minutes],
      // These Actions have to be executed in the same TX all-or-nothing
      actions: [actionTradeKyber, actionUpdateConditionTime],
      selfProviderGasLimit: estimatedGasPerExecution, // We only want this execution to at most consume a gasLimit of "estimatedGasPerExecution"
      selfProviderGasLimit: 0, // We want to execute this transaction no matter the current gasPrice
    });
  });

  // --> Step 2: Submit your Task to Gelato via your GelatoUserProxy
  it("Transaction submitting your Task via your GelatoUserProxy", async function () {
    // First we want to make sure that the Task we want to submit actually has
    // a valid Provider, so we need to ask GelatoCore some questions about the Provider.

    // Instantiate GelatoCore contract instance for sanity checks
    const gelatoCore = await ethers.getContractAt(
      "IGelatoProviders", // fetches the contract ABI from artifacts/
      network.config.deployments.GelatoCore // the Rinkeby Address of the deployed GelatoCore
    );

    // For our Task to be executable, our Provider must have sufficient funds on Gelato
    const providerIsLiquid = await gelatoCore.isProviderLiquid(
      myUserProxyAddress,
      estimatedGasPerExecution.mul(ethers.utils.bigNumberify("3")), // we need roughtly estimatedGasPerExecution * 3 executions as balance on gelato
      currentGelatoGasPrice
    );
    if (!providerIsLiquid) {
      console.log(
        "\n ❌  Ooops! Your Provider needs to provide more funds to Gelato \n"
      );
      console.log("DEMO: run this command: `yarn provide` first");
      process.exit(1);
    }

    // For the Demo, make sure the Provider has the Gelato default Executor assigned
    const assignedExecutor = await gelatoCore.executorByProvider(
      myUserProxyAddress
    );
    if (assignedExecutor !== defaultExecutor) {
      console.log(
        "\n ❌  Ooops! Your Provider needs to assign the gelato default Executor \n"
      );
      console.log("DEMO: run this command: `yarn provide` first");
      process.exit(1);
    }

    // For the Demo, our Provider must use the deployed ProviderModuleGelatoUserProxy
    const userProxyModuleIsProvided = await gelatoCore.isModuleProvided(
      myUserProxyAddress,
      network.config.deployments.ProviderModuleGelatoUserProxy
    );
    if (!userProxyModuleIsProvided) {
      console.log(
        "\n ❌  Ooops! Your Provider still needs to add ProviderModuleGelatoUserProxy \n"
      );
      console.log("DEMO: run this command: `yarn provide` first");
      process.exit(1);
    }

    // The single Transaction that deploys your GelatoUserProxy and submits your Task Cycle
    if (
      providerIsLiquid &&
      assignedExecutor === defaultExecutor &&
      userProxyModuleIsProvided
    ) {
      // We also want to keep track of token balances in our UserWallet
      const myUserWalletDAIBalance = await bre.run("erc20-balance", {
        erc20name: "DAI",
        owner: myUserAddress,
      });

      // Since our Proxy will move a total of 3 DAI from our UserWallet to
      // trade them for KNC and pay the Provider fee, we need to make sure the we
      // have the DAI balance
      if (!myUserWalletDAIBalance.gte(3)) {
        console.log(
          "\n ❌ Ooops! You need at least 3 DAI in your UserWallet \n"
        );
        process.exit(1);
      }

      // We also monitor the DAI approval our GelatoUserProxy has from us
      const myUserProxyDAIAllowance = await bre.run("erc20-allowance", {
        owner: myUserAddress,
        erc20name: "DAI",
        spender: myUserProxyAddress,
      });

      // ###### 1st TX => APPROVE USER PROXY TO MOVE DAI

      // Since our Proxy will move a total of 3 DAI from our UserWallet to
      // trade them for KNC and pay the Provider fee, we need to make sure the we
      // that we have approved our UserProxy. We can already approve it before
      // we have even deployed it, due to create2 address prediction magic.
      if (!myUserProxyDAIAllowance.gte(utils.parseUnits("3", 18))) {
        try {
          console.log("\n Sending Transaction to approve UserProxy for DAI.");
          console.log("\n Waiting for DAI Approval Tx to be mined....");
          await bre.run("erc20-approve", {
            erc20name: "DAI",
            amount: utils.parseUnits("3", 18).toString(),
            spender: myUserProxyAddress,
          });
          console.log(
            "\n Gelato User Proxy now has your Approval to move 3 DAI  ✅ \n"
          );
        } catch (error) {
          console.error("\n UserProxy DAI Approval failed ❌  \n", error);
          process.exit(1);
        }
      } else {
        console.log(
          "\n Gelato User Proxy already has your Approval to move 3 DAI  ✅ \n"
        );
      }

      // To submit Tasks to  Gelato we need to instantiate a GelatoProvider object
      const myGelatoProvider = new GelatoProvider({
        addr: myUserProxyAddress, // As the user is paying for the gelato transactions himself, the provider address will equal the users proxy address
        module: network.config.deployments.ProviderModuleGelatoUserProxy,
      });

      // We should also specify an expiryDate for our Task Cycle
      // Since we want to trade 3 times every 2 minutes, something like 15 minutes from
      //  now should be reasonably safe in case of higher network latency.
      // You can also simply input 0 to not have an expiry date
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const expiryDate = nowInSeconds + 900; // 15 minutes from now

      // ###### 2nd TX => Submit Task to gelato

      // We Submit our Task as a "Task Cycle" with 3 cycles to limit the number
      // of total Task executions to three.
      let taskSubmissionTx;
      try {
        console.log("\n Sending Transaction to submit Task!");
        taskSubmissionTx = await myUserProxy.submitTaskCycle(
          myGelatoProvider,
          [taskTradeOnKyber], // we only have one type of Task
          expiryDate, // auto-cancel if not completed in 15 minutes from now
          3, // the num of times we want our Task to be executed: 3 times every 2 minutes
          {
            gasLimit: 1000000,
            gasPrice: utils.parseUnits("10", "gwei"),
          }
        );
      } catch (error) {
        console.error("\n PRE taskSubmissionTx error ❌  \n", error);
        process.exit(1);
      }
      try {
        console.log("\n Waiting for taskSubmissionTx to get mined...");
        await taskSubmissionTx.wait();
        console.log("Task Submitted ✅ \n");
        console.log("Task will be executed a total of 3 times \n");
      } catch (error) {
        console.error("\n POST taskSubmissionTx error ❌ ", error);
        process.exit(1);
      }
    }
  });
});
