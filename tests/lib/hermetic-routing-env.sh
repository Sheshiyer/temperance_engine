# Source at the top of a test (bash or POSIX sh) so it never inherits the operator's
# live routing environment.
#
# Operator Macs export a hosted router URL and API key (for example from ~/.zshenv:
# OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY, TEMPERANCE_OMNIROUTE_ADMIN_URL). A test that
# inherits them either fails a loopback-only guard, or worse, passes by talking to the
# live router with a real key. CI runners export none of these, so dropping them makes
# a local run match CI. Tests set the values they need after sourcing this file.

for _hermetic_name in $(env | sed -n \
  -e 's/^\(TEMPERANCE_OMNIROUTE_[A-Za-z0-9_]*\)=.*/\1/p' \
  -e 's/^\(OMNIROUTE_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$_hermetic_name"
done
unset _hermetic_name \
  ANTHROPIC_BASE_URL ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN \
  OPENAI_BASE_URL OPENAI_API_KEY
