export interface AwsRegion {
  id: string
  name: string
  bedrockSupported: boolean
}

// Regions where Amazon Bedrock is available.
// Reference: https://docs.aws.amazon.com/general/latest/gr/bedrock.html
// Last verified: YYYY-MM-DD (update when AWS adds or removes support).
export const AWS_REGIONS: AwsRegion[] = [
  // North America - Bedrock supported
  {
    id: 'us-east-1',
    name: 'US East (N. Virginia)',
    bedrockSupported: true
  },
  {
    id: 'us-east-2',
    name: 'US East (Ohio)',
    bedrockSupported: true
  },
  {
    id: 'us-west-2',
    name: 'US West (Oregon)',
    bedrockSupported: true
  },
  {
    id: 'ca-central-1',
    name: 'Canada (Central)',
    bedrockSupported: true
  },
  // Asia Pacific - Bedrock supported
  {
    id: 'ap-south-1',
    name: 'Asia Pacific (Mumbai)',
    bedrockSupported: true
  },
  {
    id: 'ap-south-2',
    name: 'Asia Pacific (Hyderabad)',
    bedrockSupported: true
  },
  {
    id: 'ap-northeast-1',
    name: 'Asia Pacific (Tokyo)',
    bedrockSupported: true
  },
  {
    id: 'ap-northeast-2',
    name: 'Asia Pacific (Seoul)',
    bedrockSupported: true
  },
  {
    id: 'ap-northeast-3',
    name: 'Asia Pacific (Osaka)',
    bedrockSupported: true
  },
  {
    id: 'ap-southeast-1',
    name: 'Asia Pacific (Singapore)',
    bedrockSupported: true
  },
  {
    id: 'ap-southeast-2',
    name: 'Asia Pacific (Sydney)',
    bedrockSupported: true
  },
  // Europe - Bedrock supported
  {
    id: 'eu-central-1',
    name: 'Europe (Frankfurt)',
    bedrockSupported: true
  },
  {
    id: 'eu-central-2',
    name: 'Europe (Zurich)',
    bedrockSupported: true
  },
  {
    id: 'eu-west-1',
    name: 'Europe (Ireland)',
    bedrockSupported: true
  },
  {
    id: 'eu-west-2',
    name: 'Europe (London)',
    bedrockSupported: true
  },
  {
    id: 'eu-west-3',
    name: 'Europe (Paris)',
    bedrockSupported: true
  },
  {
    id: 'eu-north-1',
    name: 'Europe (Stockholm)',
    bedrockSupported: true
  },
  {
    id: 'eu-south-1',
    name: 'Europe (Milan)',
    bedrockSupported: true
  },
  {
    id: 'eu-south-2',
    name: 'Europe (Spain)',
    bedrockSupported: true
  },
  // South America - Bedrock supported
  {
    id: 'sa-east-1',
    name: 'South America (São Paulo)',
    bedrockSupported: true
  },
  // Additional major regions where Bedrock is not yet available
  {
    id: 'us-west-1',
    name: 'US West (N. California)',
    bedrockSupported: false
  },
  {
    id: 'ap-southeast-3',
    name: 'Asia Pacific (Jakarta)',
    bedrockSupported: false
  },
  {
    id: 'ap-southeast-4',
    name: 'Asia Pacific (Melbourne)',
    bedrockSupported: false
  },
  {
    id: 'ap-east-1',
    name: 'Asia Pacific (Hong Kong)',
    bedrockSupported: false
  }
]
