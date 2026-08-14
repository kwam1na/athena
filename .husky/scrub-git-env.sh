for ATHENA_GIT_ENV_NAME in $(
  env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'
); do
  unset "$ATHENA_GIT_ENV_NAME"
done
unset ATHENA_GIT_ENV_NAME
