import { resetDatabase } from "../scripts/db-reset";

export default async function setup() {
  await resetDatabase("ledgr_test");
}
