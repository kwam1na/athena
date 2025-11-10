#!/bin/bash

# Fun name generator
random_fun_name() {
  ADJECTIVES=(brave clever happy quick silent wild gentle proud tiny wise)
  NOUNS=(tiger eagle panda fox whale lion wolf bear owl dolphin)
  VERBS=(jumps runs flies swims roars climbs glides prowls soars dashes)
  ADJ=${ADJECTIVES[$RANDOM % ${#ADJECTIVES[@]}]}
  NOUN=${NOUNS[$RANDOM % ${#NOUNS[@]}]}
  VERB=${VERBS[$RANDOM % ${#VERBS[@]}]}
  echo "$ADJ-$NOUN-$VERB"
}

function deploy-athena {
  echo "building and deploying Athena..."
  TIMESTAMP=$(date +%Y%m%d%H%M%S)
  FUN_NAME=$(random_fun_name)
  VERSION_PATH="/home/ec2-user/athena/athena-webapp/versions/$TIMESTAMP"
  SYMLINK_PATH="/home/ec2-user/athena/athena-webapp/current"

  VITE_CONVEX_URL=https://colorless-cardinal-870.convex.cloud \
  VITE_API_GATEWAY_URL='https://colorless-cardinal-870.convex.site' \
  VITE_STOREFRONT_URL='https://wigclub.store' \
  VITE_HLS_URL='https://d37wmi4mfpeer9.cloudfront.net' \
  bun run build &&

  ssh -i /Users/kwamina/Desktop/athena-webserver/athena-eu-west-key.pem \
  ec2-user@ec2-34-244-249-177.eu-west-1.compute.amazonaws.com "mkdir -p $VERSION_PATH && echo '$FUN_NAME' > $VERSION_PATH/fun-name.txt" &&

  scp -i /Users/kwamina/Desktop/athena-webserver/athena-eu-west-key.pem \
  -r dist/* ec2-user@ec2-34-244-249-177.eu-west-1.compute.amazonaws.com:$VERSION_PATH &&

  ssh -i /Users/kwamina/Desktop/athena-webserver/athena-eu-west-key.pem \
  ec2-user@ec2-34-244-249-177.eu-west-1.compute.amazonaws.com "ln -sfn $VERSION_PATH $SYMLINK_PATH" &&

  echo "✅ Deployed version: $FUN_NAME ($TIMESTAMP)"
}

function deploy-storefront {
  echo "building and deploying store..."
  TIMESTAMP=$(date +%Y%m%d%H%M%S)
  FUN_NAME=$(random_fun_name)
  VERSION_PATH="/home/ec2-user/athena/storefront/versions/$TIMESTAMP"
  SYMLINK_PATH="/home/ec2-user/athena/storefront/current"

  VITE_API_URL='https://api.wigclub.store' \
  VITE_HLS_URL='https://d37wmi4mfpeer9.cloudfront.net' \
  bun run build &&

  ssh -i /Users/kwamina/Desktop/athena-webserver/athena-eu-west-key.pem \
  ec2-user@ec2-34-244-249-177.eu-west-1.compute.amazonaws.com "mkdir -p $VERSION_PATH && echo '$FUN_NAME' > $VERSION_PATH/fun-name.txt" &&

  scp -i /Users/kwamina/Desktop/athena-webserver/athena-eu-west-key.pem \
  -r dist/* ec2-user@ec2-34-244-249-177.eu-west-1.compute.amazonaws.com:$VERSION_PATH &&

  ssh -i /Users/kwamina/Desktop/athena-webserver/athena-eu-west-key.pem \
  ec2-user@ec2-34-244-249-177.eu-west-1.compute.amazonaws.com "ln -sfn $VERSION_PATH $SYMLINK_PATH" &&

  echo "✅ Deployed version: $FUN_NAME ($TIMESTAMP)"
}

function full-deploy-athena {
  npx convex deploy && deploy-athena
}

function dpb-athena {
  npx convex deploy
}

chmod +x deploy-athena.sh 