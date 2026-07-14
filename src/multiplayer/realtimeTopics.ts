let gameListSubscriptionId = 0;

export function createGameListRealtimeTopic() {
  gameListSubscriptionId += 1;
  return `games:list:${gameListSubscriptionId}`;
}
