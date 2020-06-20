// running `npx buidler test` automatically makes use of buidler-waffle plugin
// => only dependency we need is "chai"
import { expect } from "chai";

// We require the Buidler Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
// When running the script with `buidler run <script>` you'll find the Buidler
// Runtime Environment's members available in the global scope.
import bre from "@nomiclabs/buidler";

describe("Gelato-Kyber Demo Part 1: Step 4 => Whitelist Task", function () {
  // No timeout for Mocha due to Rinkeby mining latency
  this.timeout(0);

  // We use our Provider Wallet
  let myProviderAddress;
  let myProviderWallet;

  // We will send a Transaction to GelatoCore on Rinkeby
  const gelatoCoreAddress = bre.network.config.deployments.GelatoCore;
  let gelatoCore;

  // --> Conditions & Actions => Task (see Step1 of Demo)
  // 1) We use the already deployed instance of ConditionTimeStateful
  const conditionTimeStatefulAddress =
    bre.network.config.deployments.ConditionTimeStateful;
  // 2) We use the already deployed instance of ActionFeeHandler
  const actionFeeHandlerAddress =
    bre.network.config.deployments.ActionFeeHandler;
  // 3) We use the already deployed instance of ActionKyberTrade
  const actionKyberTradeAddress =
    bre.network.config.deployments.ActionKyberTrade;

  // --> Step 4: Whitelist Tasks
  // For this we create a specific Gelato object called a TaskSpec
  // The TaskSpec only needs the address of the Condition, but we need to provide
  /// more information about the Actions:
  // We start with the Action that takes our 10% Provider cut from the Users' DAI
  const actionFeeHandler = new Action({
    addr: actionFeeHandlerAddress,
    data: constants.HashZero, // The exact Action payload is ignored for whitelisting
    operation: Operation.Delegatecall, // This Action must be executed via the UserProxy
    dataFlow: DataFlow.Out, // Tell ActionKyberTrade how much DAI to sell after fee
    termsOkCheck: true, // Some sanity checks have to pass before Execution is granted
  });
  // Next, we chain the Action that automatically trades for our Users on Kyber
  const kyberAction = new Action({
    addr: actionKyberTradeAddress, // The address of the contract with the Action logic
    data: constants.HashZero, // The exact Action payload is ignored for whitelisting
    operation: Operation.Delegatecall, // This Action must be executed via the UserProxy
    dataFlow: DataFlow.In, // Expects DAI sell amount after fee from actionFeeHandler
    termsOkCheck: true, // Some sanity checks have to pass before Execution is granted
  });
  // We also need to chain a third Action that updates ConditionTimeStateful
  const updateConditionTimeAction = new Action({
    addr: conditionTimeStatefulAddress,
    data: constants.HashZero, // The exact Action payload is ignored for whitelisting
    operation: Operation.Call, // This Action must be executed via the UserProxy
  });

  // We also need to specify up to which gasPrice the Action should be executable
  const gasPriceCeil = utils.parseUnits("50", "gwei");

  // This is all the info we need for the TaskSpec whitelisting
  const gelatoKyberTaskSpec = new TaskSpec({
    // All the conditions have to be met
    conditions: [conditionTimeStatefulAddress],
    // These Actions have to be executed in the same TX all-or-nothing
    actions: [actionFeeHandler, kyberAction, updateConditionTimeAction],
    gasPriceCeil,
  });

  before(async function () {
    // We get our Provider Wallet from the Buidler Runtime Env
    myProviderWallet = await bre.getProviderWallet();
    myProviderAddress = await myProviderWallet.getAddress();

    // Instantiate GelatoCore contract instance connected to our ProviderWallet
    gelatoCore = await ethers.getContractAt(
      "IGelatoProviders", // fetches the contract ABI from artifacts/
      gelatoCoreAddress, // the Rinkeby Address of the deployed GelatoCore
      myProviderWallet // We send a tx to the contract from our Provider Wallet
    );
  });

  it("Transaction to whitelist Demo Task", async function () {
    // First we want to make sure that we havent already provided the TaskSpec
    const taskSpecIsNotProvided =
      (await gelatoCore.isTaskSpecProvided(
        myProviderAddress,
        gelatoKyberTaskSpec
      )) === "TaskSpecNotProvided"
        ? true
        : false;

    // Transaction
    if (taskSpecIsNotProvided) {
      let provideTaskSpec;
      try {
        provideTaskSpec = await gelatoCore.provideTaskSpecs(
          [gelatoKyberTaskSpec],
          {
            gasLimit: 6000000,
            gasPrice: utils.parseUnits("10", "gwei"),
          }
        );
      } catch (error) {
        console.error("\n PRE provideTaskSpecs TX error ❌  \n", error);
        process.exit(1);
      }
      try {
        console.log("\n Waiting for provideTaskSpecs TX to get mined...");
        await provideTaskSpec.wait();
        console.log("provideTaskSpecs TX mined and ok ✅ \n");
      } catch (error) {
        console.error("\n provideTaskSpecs TX error ❌ ", error);
        process.exit(1);
      }
    } else {
      console.log("\n TaskSpec already provided ✅ \n");
    }

    // Making sure the TaskSpec was provided
    expect(
      await gelatoCore.isTaskSpecProvided(
        myProviderAddress,
        gelatoKyberTaskSpec
      )
    ).to.be.equal("OK");
  });
});
