// Automatically generated - do not edit!
// --------------------------------------
const protobuf = require('protobufjs')
const files = [
  "./root/cosmos/auth/v1beta1/auth.proto",
  "./root/cosmos/auth/v1beta1/query.proto",
  "./root/cosmos/auth/v1beta1/genesis.proto",
  "./root/cosmos/bank/v1beta1/query.proto",
  "./root/cosmos/bank/v1beta1/tx.proto",
  "./root/cosmos/bank/v1beta1/bank.proto",
  "./root/cosmos/bank/v1beta1/genesis.proto",
  "./root/cosmos/tx/v1beta1/service.proto",
  "./root/cosmos/tx/v1beta1/tx.proto",
  "./root/cosmos/tx/signing/v1beta1/signing.proto",
  "./root/cosmos/upgrade/v1beta1/upgrade.proto",
  "./root/cosmos/upgrade/v1beta1/query.proto",
  "./root/cosmos/slashing/v1beta1/query.proto",
  "./root/cosmos/slashing/v1beta1/tx.proto",
  "./root/cosmos/slashing/v1beta1/genesis.proto",
  "./root/cosmos/slashing/v1beta1/slashing.proto",
  "./root/cosmos/evidence/v1beta1/evidence.proto",
  "./root/cosmos/evidence/v1beta1/query.proto",
  "./root/cosmos/evidence/v1beta1/tx.proto",
  "./root/cosmos/evidence/v1beta1/genesis.proto",
  "./root/cosmos/gov/v1beta1/gov.proto",
  "./root/cosmos/gov/v1beta1/query.proto",
  "./root/cosmos/gov/v1beta1/tx.proto",
  "./root/cosmos/gov/v1beta1/genesis.proto",
  "./root/cosmos/staking/v1beta1/staking.proto",
  "./root/cosmos/staking/v1beta1/query.proto",
  "./root/cosmos/staking/v1beta1/tx.proto",
  "./root/cosmos/staking/v1beta1/genesis.proto",
  "./root/cosmos/authz/v1beta1/query.proto",
  "./root/cosmos/authz/v1beta1/tx.proto",
  "./root/cosmos/authz/v1beta1/genesis.proto",
  "./root/cosmos/authz/v1beta1/authz.proto",
  "./root/cosmos/mint/v1beta1/mint.proto",
  "./root/cosmos/mint/v1beta1/query.proto",
  "./root/cosmos/mint/v1beta1/genesis.proto",
  "./root/cosmos/params/v1beta1/query.proto",
  "./root/cosmos/params/v1beta1/params.proto",
  "./root/cosmos/crisis/v1beta1/tx.proto",
  "./root/cosmos/crisis/v1beta1/genesis.proto",
  "./root/cosmos/distribution/v1beta1/query.proto",
  "./root/cosmos/distribution/v1beta1/tx.proto",
  "./root/cosmos/distribution/v1beta1/genesis.proto",
  "./root/cosmos/distribution/v1beta1/distribution.proto",
  "./root/cosmos/crypto/multisig/v1beta1/multisig.proto",
  "./root/cosmos/crypto/multisig/keys.proto",
  "./root/cosmos/crypto/secp256k1/keys.proto",
  "./root/cosmos/crypto/ed25519/keys.proto",
  "./root/cosmos/genutil/v1beta1/genesis.proto",
  "./root/cosmos/vesting/v1beta1/tx.proto",
  "./root/cosmos/vesting/v1beta1/vesting.proto",
  "./root/cosmos/base/abci/v1beta1/abci.proto",
  "./root/cosmos/base/store/v1beta1/commit_info.proto",
  "./root/cosmos/base/store/v1beta1/snapshot.proto",
  "./root/cosmos/base/tendermint/v1beta1/query.proto",
  "./root/cosmos/base/reflection/v1beta1/reflection.proto",
  "./root/cosmos/base/kv/v1beta1/kv.proto",
  "./root/cosmos/base/v1beta1/coin.proto",
  "./root/cosmos/base/query/v1beta1/pagination.proto",
  "./root/cosmos/base/snapshots/v1beta1/snapshot.proto",
  "./root/cosmos/feegrant/v1beta1/feegrant.proto",
  "./root/cosmos/feegrant/v1beta1/query.proto",
  "./root/cosmos/feegrant/v1beta1/tx.proto",
  "./root/cosmos/feegrant/v1beta1/genesis.proto",
  "./root/cosmos/capability/v1beta1/genesis.proto",
  "./root/cosmos/capability/v1beta1/capability.proto",
  "./root/gogoproto/gogo.proto",
  "./root/ibc/lightclients/tendermint/v1/tendermint.proto",
  "./root/ibc/lightclients/solomachine/v1/solomachine.proto",
  "./root/ibc/lightclients/localhost/v1/localhost.proto",
  "./root/ibc/core/client/v1/query.proto",
  "./root/ibc/core/client/v1/client.proto",
  "./root/ibc/core/client/v1/tx.proto",
  "./root/ibc/core/client/v1/genesis.proto",
  "./root/ibc/core/channel/v1/channel.proto",
  "./root/ibc/core/channel/v1/query.proto",
  "./root/ibc/core/channel/v1/tx.proto",
  "./root/ibc/core/channel/v1/genesis.proto",
  "./root/ibc/core/commitment/v1/commitment.proto",
  "./root/ibc/core/types/v1/genesis.proto",
  "./root/ibc/core/connection/v1/connection.proto",
  "./root/ibc/core/connection/v1/query.proto",
  "./root/ibc/core/connection/v1/tx.proto",
  "./root/ibc/core/connection/v1/genesis.proto",
  "./root/ibc/applications/transfer/v1/query.proto",
  "./root/ibc/applications/transfer/v1/tx.proto",
  "./root/ibc/applications/transfer/v1/genesis.proto",
  "./root/ibc/applications/transfer/v1/transfer.proto",
  "./root/tendermint/abci/types.proto",
  "./root/tendermint/p2p/types.proto",
  "./root/tendermint/types/types.proto",
  "./root/tendermint/types/evidence.proto",
  "./root/tendermint/types/validator.proto",
  "./root/tendermint/types/params.proto",
  "./root/tendermint/types/block.proto",
  "./root/tendermint/libs/bits/types.proto",
  "./root/tendermint/crypto/keys.proto",
  "./root/tendermint/crypto/proof.proto",
  "./root/tendermint/version/types.proto",
  "./root/google/protobuf/any.proto",
  "./root/google/api/annotations.proto",
  "./root/google/api/httpbody.proto",
  "./root/google/api/http.proto",
  "./root/confio/proofs.proto",
  "./root/microtick/v1beta1/keeper/OrderedList.proto",
  "./root/microtick/v1beta1/keeper/DataActiveTrade.proto",
  "./root/microtick/v1beta1/keeper/DataAccountStatus.proto",
  "./root/microtick/v1beta1/keeper/DataActiveQuote.proto",
  "./root/microtick/v1beta1/keeper/CommissionPool.proto",
  "./root/microtick/v1beta1/keeper/Termination.proto",
  "./root/microtick/v1beta1/keeper/DataMarket.proto",
  "./root/microtick/v1beta1/keeper/InternalDuration.proto",
  "./root/microtick/v1beta1/msg/QueryMarket.proto",
  "./root/microtick/v1beta1/msg/QuerySynthetic.proto",
  "./root/microtick/v1beta1/msg/TxSettle.proto",
  "./root/microtick/v1beta1/msg/QueryOrderBook.proto",
  "./root/microtick/v1beta1/msg/Proposal.proto",
  "./root/microtick/v1beta1/msg/QueryTrade.proto",
  "./root/microtick/v1beta1/msg/TxDeposit.proto",
  "./root/microtick/v1beta1/msg/QueryParams.proto",
  "./root/microtick/v1beta1/msg/QueryQuote.proto",
  "./root/microtick/v1beta1/msg/GRPC.proto",
  "./root/microtick/v1beta1/msg/TxPick.proto",
  "./root/microtick/v1beta1/msg/QueryAccount.proto",
  "./root/microtick/v1beta1/msg/TxCancel.proto",
  "./root/microtick/v1beta1/msg/QueryConsensus.proto",
  "./root/microtick/v1beta1/msg/TxTrade.proto",
  "./root/microtick/v1beta1/msg/TxUpdate.proto",
  "./root/microtick/v1beta1/msg/TxCreate.proto",
  "./root/microtick/v1beta1/msg/TxWithdraw.proto",
  "./root/microtick/v1beta1/types/Balances.proto",
  "./root/microtick/v1beta1/types/Params.proto",
  "./root/microtick/v1beta1/types/Genesis.proto",
  "./root/cosmos_proto/cosmos.proto",
]
const root = new protobuf.Root()
root.loadSync(files)
module.exports = {
  create: (path, obj) => {
    const lookup = root.lookupType(path)
    const msg = lookup.fromObject(obj)
    return lookup.encode(msg).finish()
  },
  decode: (path, buf, deep) => {
    const lookup = root.lookupType(path)
    // Weird having to do this - protobufjs overrides some defaults and what is returned doesn't
    // behave like a traditional object.  The toObject() function does not recursively decode Any types.
    // So, we do this... <shrug>
    const msg = lookup.decode(buf)
    if (deep) {
      return JSON.parse(JSON.stringify(msg))
    }
    return lookup.toObject(msg, { enums: String, bytes: String })
  }
}
