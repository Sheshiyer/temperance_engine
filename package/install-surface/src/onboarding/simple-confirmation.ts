/** One-keystroke confirmation shared by every reviewed onboarding surface. */
export function isSimpleConfirmationKey(keyName: string): boolean {
  return keyName === "enter" || keyName === "return" || keyName.toLowerCase() === "y";
}
