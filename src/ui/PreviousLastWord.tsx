import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getPartingShotHand, getPartingShotText, type PartingShotLineId } from '../../shared/partingShots';
import { reportError } from '../monitoring/exceptionless';
import {
  getGame,
  hasSeenLastWord,
  markLastWordSeen,
  markRemoteGameResultSeen,
  sendRemotePartingShot,
  subscribeToGame,
} from '../multiplayer/games';
import type { RemoteGameRow } from '../multiplayer/types';
import { createBoxShadowStyle } from './boxShadow';
import { CloseIcon } from './ControlIcon';
import { PartingShotSheet } from './GameRecap';
import { Pressable } from './Pressable';

type Unit = (value: number) => number;

const black = 'Inter_900Black';
const extraBold = 'Inter_800ExtraBold';
const maxFontSizeMultiplier = 1.2;

// A rematch often starts before the other player has had their last word on
// the game before. When it lands, or was never seen, it shows here, with a way
// to fire back without leaving the rematch.
export function PreviousLastWord({
  myProfileId,
  previousGameId,
  unit,
}: {
  myProfileId: string;
  previousGameId: string;
  unit: Unit;
}) {
  const [previous, setPrevious] = useState<RemoteGameRow | null>(null);
  // The opponent line this device hasn't seen yet, as `${gameId}:${playerId}`.
  const [unseenKey, setUnseenKey] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getGame(previousGameId).then(
      (game) => {
        if (active) setPrevious(game);
      },
      // A removed or unreadable game just has nothing to show.
      (error: unknown) => void reportError(error, { GameId: previousGameId, Operation: 'Load previous game' }),
    );
    const unsubscribe = subscribeToGame(previousGameId, (game) => {
      if (active) setPrevious(game);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [previousGameId]);

  const opponentShot = previous?.state.partingShots?.find((shot) => shot.playerId !== myProfileId) ?? null;
  const shotKey = opponentShot ? `${previousGameId}:${opponentShot.playerId}` : null;

  useEffect(() => {
    if (!opponentShot) return;
    let active = true;
    const key = `${previousGameId}:${opponentShot.playerId}`;
    void hasSeenLastWord(previousGameId, opponentShot.playerId).then((seen) => {
      if (active && !seen) setUnseenKey(key);
    });
    return () => {
      active = false;
    };
  }, [opponentShot, previousGameId]);

  if (!previous || !opponentShot || unseenKey !== shotKey) return null;

  const me = previous.state.players.find((player) => player.id === myProfileId);
  const opponentName =
    previous.state.players.find((player) => player.id === opponentShot.playerId)?.name ?? 'Your opponent';
  const hand = me ? getPartingShotHand(previous.state, myProfileId) : null;

  function acknowledge(game: RemoteGameRow) {
    setUnseenKey(null);
    setIsSheetOpen(false);
    void markLastWordSeen(previousGameId, opponentShot!.playerId);
    // Seen here, so the old game needn't come back to the games list for it.
    markRemoteGameResultSeen(previousGameId, game.updated_at).catch((error: unknown) =>
      reportError(error, { GameId: previousGameId, Operation: 'Mark previous result seen' }),
    );
  }

  function send(lineId: PartingShotLineId) {
    setIsSending(true);
    setSendFailed(false);
    sendRemotePartingShot(previousGameId, lineId).then(
      (result) => {
        setIsSending(false);
        setPrevious(result.game);
        acknowledge(result.game);
      },
      (error: unknown) => {
        setIsSending(false);
        setSendFailed(true);
        void reportError(error, { GameId: previousGameId, Operation: 'Fire back from rematch' });
      },
    );
  }

  if (isSheetOpen && me && hand) {
    return (
      <View style={styles.sheetLayer}>
        <PartingShotSheet
          failed={sendFailed}
          home={me}
          isSending={isSending}
          lines={hand}
          onClose={() => setIsSheetOpen(false)}
          onSend={send}
          opponentName={opponentName}
          shots={previous.state.partingShots ?? []}
          unit={unit}
        />
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={`${opponentName}'s last word from your last game: ${getPartingShotText(opponentShot.lineId)}`}
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        {
          borderRadius: unit(12),
          gap: unit(6),
          left: unit(12),
          paddingBottom: unit(10),
          paddingHorizontal: unit(13),
          paddingTop: unit(10),
          right: unit(12),
          top: unit(140),
        },
      ]}
      testID="previous-last-word"
    >
      <Text
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        numberOfLines={1}
        style={[styles.label, { fontSize: Math.max(10, unit(10)), paddingRight: unit(30) }]}
      >
        {opponentName}&apos;s last word · last game
      </Text>
      <Text
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={[styles.text, { fontSize: unit(17), lineHeight: unit(21) }]}
      >
        {getPartingShotText(opponentShot.lineId)}
      </Text>
      {hand ? (
        <Pressable
          accessibilityLabel={`Fire back at ${opponentName}`}
          accessibilityRole="button"
          onPress={() => {
            setSendFailed(false);
            setIsSheetOpen(true);
          }}
          style={({ pressed }) => [
            styles.fireBack,
            { borderRadius: unit(10), minHeight: Math.max(44, unit(40)) },
            pressed && styles.pressed,
          ]}
          testID="previous-last-word-fire-back"
        >
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.fireBackText, { fontSize: unit(15) }]}>
            💬 Fire back
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel="Dismiss last word"
        accessibilityRole="button"
        hitSlop={unit(8)}
        onPress={() => acknowledge(previous)}
        style={({ pressed }) => [
          styles.close,
          { height: Math.max(30, unit(30)), right: unit(4), top: unit(4), width: Math.max(30, unit(30)) },
          pressed && styles.pressed,
        ]}
        testID="previous-last-word-dismiss"
      >
        <CloseIcon color="#210505" size={unit(14)} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF3C2',
    borderColor: '#210505',
    borderWidth: 3,
    ...createBoxShadowStyle(0, 5, 0, 'rgba(5, 5, 5, 0.48)'),
    elevation: 14,
    position: 'absolute',
    zIndex: 72,
  },
  close: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  fireBack: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#210505',
    borderWidth: 2,
    justifyContent: 'center',
    marginTop: 2,
  },
  fireBackText: {
    color: '#FFF3C2',
    fontFamily: black,
    fontWeight: '900',
  },
  label: {
    color: '#8F0000',
    fontFamily: extraBold,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  pressed: {
    opacity: 0.72,
  },
  sheetLayer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 80,
  },
  text: {
    color: '#210505',
    fontFamily: black,
    fontWeight: '900',
  },
});
