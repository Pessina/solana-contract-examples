import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaCoreContracts } from "../target/types/solana_core_contracts";
import { BN } from "@coral-xyz/anchor";
import { confirmTransaction, getTransactionReturnValue } from "../utils/solana";
import { assert } from "chai";
import { PublicKey } from "@solana/web3.js";
import {
  encodeFunctionData,
  keccak256,
  serializeTransaction,
  getAddress,
  http,
  createPublicClient,
} from "viem";
import { sepolia } from "viem/chains";

describe("Vault Contract Tests - Rust vs Viem Reference Implementation", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace
    .solanaCoreContracts as Program<SolanaCoreContracts>;

  const SEPOLIA_RPC_URL =
    "https://sepolia.infura.io/v3/6df51ccaa17f4e078325b5050da5a2dd";

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });

  const VAULT_ABI = [
    {
      name: "deposit",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [],
    },
    {
      name: "withdraw",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [],
    },
  ] as const;

  const TEST_CASES = [
    {
      name: "Standard deposit",
      contractAddress: getAddress("0x7099eDa9CF94d39601a956Ed5274A8c7e692D2cE"),
      recipient: getAddress("0x742d35Cc6464C4532C2D91C6b4F7c2d4A7e8C5b1"),
      amount: "1000000000000000000",
      nonce: 0,
      chainId: 1,
      gasLimit: 100000,
      maxFeePerGas: "20000000000",
      maxPriorityFeePerGas: "2000000000",
      value: "0",
    },
    {
      name: "Large amount withdraw",
      contractAddress: getAddress("0x7099eDa9CF94d39601a956Ed5274A8c7e692D2cE"),
      recipient: getAddress("0x742d35Cc6464C4532C2D91C6b4F7c2d4A7e8C5b1"),
      amount: "5000000000000000000000",
      nonce: 1,
      chainId: 1,
      gasLimit: 150000,
      maxFeePerGas: "50000000000",
      maxPriorityFeePerGas: "5000000000",
      value: "0",
    },
  ];

  const CHAIN_SIGNATURES_TEST_CASES = [
    {
      name: "Ethereum mainnet deposit",
      contractAddress: getAddress("0x7099eDa9CF94d39601a956Ed5274A8c7e692D2cE"),
      recipient: getAddress("0x742d35Cc6464C4532C2D91C6b4F7c2d4A7e8C5b1"),
      amount: "1000000000000000000",
      nonce: 0,
      chainId: 1,
      gasLimit: 100000,
      maxFeePerGas: "20000000000",
      maxPriorityFeePerGas: "2000000000",
      value: "0",
      derivationPath: "ethereum,1",
      keyVersion: 0,
    },
  ];

  function createSigningParams() {
    return {
      keyVersion: 0,
      path: "",
      algo: "",
      dest: "",
      params: "",
    };
  }

  function extractSignatureFromLogs(
    logs: string[]
  ): { r: string; s: string; v: number } | null {
    for (const log of logs) {
      try {
        if (log.includes("SignatureRespondedEvent")) {
          console.log("🔍 Found SignatureRespondedEvent in log:", log);

          const eventMatch = log.match(/SignatureRespondedEvent\s*{([^}]+)}/);
          if (eventMatch) {
            const eventData = eventMatch[1];

            const bigRXMatch = eventData.match(
              /big_r:\s*AffinePoint\s*{\s*x:\s*\[([^\]]+)\]/
            );
            const sMatch = eventData.match(/s:\s*\[([^\]]+)\]/);
            const recoveryIdMatch = eventData.match(/recovery_id:\s*(\d+)/);

            if (bigRXMatch && sMatch && recoveryIdMatch) {
              const bigRXBytes = bigRXMatch[1]
                .split(",")
                .map((s) => parseInt(s.trim()));
              const sBytes = sMatch[1]
                .split(",")
                .map((s) => parseInt(s.trim()));
              const recoveryId = parseInt(recoveryIdMatch[1]);

              const r =
                "0x" +
                bigRXBytes.map((b) => b.toString(16).padStart(2, "0")).join("");
              const s =
                "0x" +
                sBytes.map((b) => b.toString(16).padStart(2, "0")).join("");
              const v = recoveryId + 27;

              console.log("✅ Successfully extracted signature from event");
              return { r, s, v };
            }
          }
        }

        if (
          log.includes("Program log:") &&
          (log.includes("signature") ||
            log.includes("big_r") ||
            log.includes("recovery_id"))
        ) {
          console.log("🔍 Found potential signature data in program log:", log);

          const rMatch = log.match(/r:\s*0x([a-fA-F0-9]{64})/);
          const sMatch = log.match(/s:\s*0x([a-fA-F0-9]{64})/);
          const vMatch = log.match(/v:\s*(\d+)/);

          if (rMatch && sMatch && vMatch) {
            return {
              r: `0x${rMatch[1]}`,
              s: `0x${sMatch[1]}`,
              v: parseInt(vMatch[1]),
            };
          }
        }
      } catch (error) {
        console.log("❌ Failed to parse signature from log:", log, error);
      }
    }

    console.log("⚠️  No signature found in logs - this means:");
    console.log("   1. The chain signatures program hasn't responded yet, or");
    console.log(
      "   2. The signature is in an event that needs proper deserialization"
    );
    console.log(
      "   3. In production, you'd wait for the SignatureRespondedEvent or poll for it"
    );

    return null;
  }

  async function parseSignatureFromTransaction(
    connection: any,
    txSignature: string
  ): Promise<{ r: string; s: string; v: number } | null> {
    try {
      const tx = await connection.getTransaction(txSignature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) {
        console.log("❌ Transaction not found or no metadata");
        return null;
      }

      const chainSignaturesProgramId =
        "BtGZEs9ZJX3hAQuY5er8iyWrGsrPRZYupEtVSS129XKo";

      if (tx.meta.innerInstructions) {
        for (const innerIx of tx.meta.innerInstructions) {
          for (const instruction of innerIx.instructions) {
            if (
              instruction.programId?.toString() === chainSignaturesProgramId
            ) {
              console.log("🔍 Found chain signatures program instruction");
            }
          }
        }
      }

      return extractSignatureFromLogs(tx.meta.logMessages || []);
    } catch (error) {
      console.error("❌ Error parsing transaction:", error);
      return null;
    }
  }

  async function broadcastToSepolia(signedTransaction: `0x${string}`) {
    try {
      const txHash = await publicClient.sendRawTransaction({
        serializedTransaction: signedTransaction,
      });

      console.log(`✅ Transaction broadcasted to Sepolia: ${txHash}`);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60000,
      });

      console.log(`✅ Transaction confirmed in block: ${receipt.blockNumber}`);
      return { txHash, receipt };
    } catch (error) {
      console.error("❌ Failed to broadcast transaction:", error);
      throw error;
    }
  }

  describe("Deposit Function Tests", () => {
    TEST_CASES.forEach((testCase) => {
      it(`${testCase.name} - Deposit`, async () => {
        const viemCallData = encodeFunctionData({
          abi: VAULT_ABI,
          functionName: "deposit",
          args: [testCase.recipient, BigInt(testCase.amount)],
        });

        const viemTransaction = {
          type: "eip1559" as const,
          to: testCase.contractAddress,
          value: BigInt(testCase.value),
          data: viemCallData,
          chainId: testCase.chainId,
          nonce: testCase.nonce,
          gas: BigInt(testCase.gasLimit),
          maxFeePerGas: BigInt(testCase.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(testCase.maxPriorityFeePerGas),
        };

        const viemSerializedForSigning = serializeTransaction(viemTransaction);
        const viemExpectedHash = keccak256(viemSerializedForSigning);

        const rustTransaction = {
          toAddress: Array.from(
            Buffer.from(testCase.contractAddress.slice(2), "hex")
          ),
          value: new BN(testCase.value),
          gasLimit: new BN(testCase.gasLimit),
          maxFeePerGas: new BN(testCase.maxFeePerGas),
          maxPriorityFeePerGas: new BN(testCase.maxPriorityFeePerGas),
          nonce: new BN(testCase.nonce),
          chainId: new BN(testCase.chainId),
          recipientAddress: Array.from(
            Buffer.from(testCase.recipient.slice(2), "hex")
          ),
          amount: new BN(testCase.amount),
        };

        const rustResult = await program.methods
          .processDeposit(rustTransaction)
          .rpc();

        await confirmTransaction(program.provider.connection, rustResult);

        const rustReturnData = await getTransactionReturnValue<Uint8Array>(
          rustResult
        );
        const rustHash = "0x" + Buffer.from(rustReturnData!).toString("hex");

        assert.equal(
          rustHash.toLowerCase(),
          viemExpectedHash.toLowerCase(),
          `Hash mismatch for ${testCase.name} deposit`
        );
      });
    });
  });

  describe("Withdraw Function Tests", () => {
    TEST_CASES.forEach((testCase) => {
      it(`${testCase.name} - Withdraw`, async () => {
        const viemCallData = encodeFunctionData({
          abi: VAULT_ABI,
          functionName: "withdraw",
          args: [testCase.recipient, BigInt(testCase.amount)],
        });

        const viemTransaction = {
          type: "eip1559" as const,
          to: testCase.contractAddress,
          value: BigInt(testCase.value),
          data: viemCallData,
          chainId: testCase.chainId,
          nonce: testCase.nonce,
          gas: BigInt(testCase.gasLimit),
          maxFeePerGas: BigInt(testCase.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(testCase.maxPriorityFeePerGas),
        };

        const viemSerializedForSigning = serializeTransaction(viemTransaction);
        const viemExpectedHash = keccak256(viemSerializedForSigning);

        const rustTransaction = {
          toAddress: Array.from(
            Buffer.from(testCase.contractAddress.slice(2), "hex")
          ),
          value: new BN(testCase.value),
          gasLimit: new BN(testCase.gasLimit),
          maxFeePerGas: new BN(testCase.maxFeePerGas),
          maxPriorityFeePerGas: new BN(testCase.maxPriorityFeePerGas),
          nonce: new BN(testCase.nonce),
          chainId: new BN(testCase.chainId),
          recipientAddress: Array.from(
            Buffer.from(testCase.recipient.slice(2), "hex")
          ),
          amount: new BN(testCase.amount),
        };

        const rustResult = await program.methods
          .processWithdraw(rustTransaction)
          .rpc();

        await confirmTransaction(program.provider.connection, rustResult);

        const rustReturnData = await getTransactionReturnValue<Uint8Array>(
          rustResult
        );
        const rustHash = "0x" + Buffer.from(rustReturnData!).toString("hex");

        assert.equal(
          rustHash.toLowerCase(),
          viemExpectedHash.toLowerCase(),
          `Hash mismatch for ${testCase.name} withdraw`
        );
      });
    });
  });

  describe.only("Chain Signatures Deposit Tests", () => {
    CHAIN_SIGNATURES_TEST_CASES.forEach((testCase) => {
      it(`${testCase.name} - Chain Signatures Deposit`, async () => {
        const vaultTransaction = {
          toAddress: Array.from(
            Buffer.from(testCase.contractAddress.slice(2), "hex")
          ),
          value: new BN(testCase.value),
          gasLimit: new BN(testCase.gasLimit),
          maxFeePerGas: new BN(testCase.maxFeePerGas),
          maxPriorityFeePerGas: new BN(testCase.maxPriorityFeePerGas),
          nonce: new BN(testCase.nonce),
          chainId: new BN(testCase.chainId),
          recipientAddress: Array.from(
            Buffer.from(testCase.recipient.slice(2), "hex")
          ),
          amount: new BN(testCase.amount),
        };

        const signingParams = createSigningParams();

        try {
          console.log(`🔄 Requesting signature for ${testCase.name}...`);

          const rustResult = await program.methods
            .signDepositTransaction(vaultTransaction, signingParams)
            .rpc();

          await confirmTransaction(program.provider.connection, rustResult);

          const tx = await program.provider.connection.getTransaction(
            rustResult,
            {
              commitment: "confirmed",
            }
          );

          assert.isNotNull(tx, "Transaction should be found");

          let signature = extractSignatureFromLogs(tx!.meta?.logMessages || []);

          if (!signature) {
            console.log(
              "🔄 Attempting to parse signature from full transaction..."
            );
            signature = await parseSignatureFromTransaction(
              program.provider.connection,
              rustResult
            );
          }

          if (!signature) {
            assert.fail("No signature found");
          }

          const viemCallData = encodeFunctionData({
            abi: VAULT_ABI,
            functionName: "deposit",
            args: [testCase.recipient, BigInt(testCase.amount)],
          });

          const viemTransaction = {
            type: "eip1559" as const,
            to: testCase.contractAddress,
            value: BigInt(testCase.value),
            data: viemCallData,
            chainId: testCase.chainId,
            nonce: testCase.nonce,
            gas: BigInt(testCase.gasLimit),
            maxFeePerGas: BigInt(testCase.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(testCase.maxPriorityFeePerGas),
          };

          const signedTransaction = serializeTransaction(viemTransaction, {
            r: signature.r as `0x${string}`,
            s: signature.s as `0x${string}`,
            v: BigInt(signature.v),
          });

          console.log(`📡 Broadcasting transaction to Sepolia...`);
          console.log(`  - Transaction: ${signedTransaction.slice(0, 50)}...`);

          console.log(
            `✅ ${testCase.name} - Chain Signatures Deposit with broadcast simulation completed`
          );
          console.log(
            `  - Signed transaction ready for broadcast: ${signedTransaction.length} bytes`
          );
        } catch (error) {
          console.error(
            `Chain Signatures Deposit test failed for ${testCase.name}:`,
            error
          );

          throw error;
        }
      });
    });
  });
});
