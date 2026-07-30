import {
  HEDERA_NETWORK,
  HEDERA_NETWORK_NAME,
  PAYMENT_ASSET_ID,
  PAYMENT_ASSET_DECIMALS,
  PAYMENT_ASSET_SYMBOL,
  MIRROR_NODE_URL,
} from './hedera'
import { facilitatorUrl } from './x402'
import { proofTopicId } from './hcs'

function require_env(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Missing required env var: ${key}`)
  return v
}

export const config = {
  supabase: {
    url: require_env('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: require_env('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceRoleKey: require_env('SUPABASE_SERVICE_ROLE_KEY'),
  },
  hedera: {
    network: HEDERA_NETWORK,
    networkName: HEDERA_NETWORK_NAME,
    operatorId: require_env('HEDERA_OPERATOR_ID'),
    operatorKey: require_env('HEDERA_OPERATOR_KEY'),
    payTo: process.env.PAY_TO_ACCOUNT ?? require_env('HEDERA_OPERATOR_ID'),
    mirrorNodeUrl: MIRROR_NODE_URL,
    proofTopicId: proofTopicId(),
  },
  x402: {
    facilitatorUrl,
    asset: PAYMENT_ASSET_ID,
    assetSymbol: PAYMENT_ASSET_SYMBOL,
    assetDecimals: PAYMENT_ASSET_DECIMALS,
  },
  groq: {
    apiKey: require_env('GROQ_API_KEY'),
  },
  app: {
    url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    price: process.env.ASP_PRICE_USDT ?? '2.00',
    feeBps: Number(process.env.ASP_FEE_BPS ?? '1200'),
  },
} as const
