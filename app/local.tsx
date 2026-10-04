import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { LocalGameScreen } from '../App';
import type { ComputerSession } from '../src/game/computerSession';
import { clearComputerSession, loadComputerSession, saveComputerSession } from '../src/game/computerSessionStorage';
import { isMultiplayerConfigured } from '../src/multiplayer';
import { getCurrentSession } from '../src/multiplayer/auth';
import { queueComputerGameResult } from '../src/multiplayer/computerStats';
import { flushComputerResults } from '../src/multiplayer/computerResultQueue';
import { useGameList } from '../src/navigation/GameListProvider';
import { Pressable } from '../src/ui/Pressable';

export default function LocalGameRoute() {
  const router = useRouter();
  const { localPlayerProfile } = useGameList();
  const [loaded, setLoaded] = useState<{ profileId: string | null; session: ComputerSession | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ownerKnown, setOwnerKnown] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [generation, setGeneration] = useState(0);
  const latestSession = useRef<ComputerSession | null>(null);
  const ownerId = useRef<string | null>(null);
  const ownerResolved = useRef(false);
  const active = useRef(true);

  const load = useCallback(() => {
    const authRequest = isMultiplayerConfigured ? getCurrentSession() : Promise.resolve(null);
    return authRequest
      .then((auth) => {
        ownerId.current = auth?.user.id ?? null;
        ownerResolved.current = true;
        return loadComputerSession(ownerId.current);
      })
      .then(async (session) => {
        if (!active.current) return;
        if (session?.game.phase === 'complete' && !session.recordedGameIds.includes(session.game.id)) {
          await queueComputerGameResult(session.game, session.actions, session.turns, ownerId.current);
          void flushComputerResults().catch(() => undefined);
        }
        if (!active.current) return;
        const resumable = session?.game.phase === 'complete' ? null : session;
        latestSession.current = resumable;
        setOwnerKnown(true);
        setLoaded({ profileId: ownerId.current, session: resumable });
        setError(null);
      })
      .catch(() => {
        if (active.current) {
          setOwnerKnown(ownerResolved.current);
          setError('Your saved computer game could not be opened. Retry or start a new game.');
        }
      });
  }, []);

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, [load]);

  const persist = useCallback((session: ComputerSession) => {
    latestSession.current = session;
    void saveComputerSession(ownerId.current, session).catch(() => {
      if (active.current) setError('Your computer game could not be saved. Retry before leaving.');
    });
  }, []);

  async function retry() {
    if (!loaded || !latestSession.current) return load();
    try {
      await saveComputerSession(ownerId.current, latestSession.current);
      setError(null);
    } catch {
      setError('Your computer game could not be saved. Retry before leaving.');
    }
  }

  async function exit() {
    try {
      if (latestSession.current) await saveComputerSession(ownerId.current, latestSession.current);
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch {
      setError('Your computer game could not be saved. Retry before leaving.');
    }
  }

  async function startNew() {
    try {
      await clearComputerSession(ownerId.current);
      latestSession.current = null;
      setLoaded({ profileId: ownerId.current, session: null });
      setGeneration((value) => value + 1);
      setError(null);
      setConfirmNew(false);
    } catch {
      setError('Your saved computer game could not be replaced. Please retry.');
    }
  }

  return (
    <View style={styles.screen}>
      {loaded ? (
        <LocalGameScreen
          key={generation}
          initialLocalSession={loaded.session}
          localPlayerProfileId={loaded.profileId}
          onLocalSessionChange={persist}
          onNewComputerGame={() => setConfirmNew(true)}
          localPlayerAvatarUrl={localPlayerProfile?.avatarUrl}
          localPlayerName={localPlayerProfile?.displayName}
          onExit={isMultiplayerConfigured ? () => void exit() : undefined}
        />
      ) : (
        <ActivityIndicator color="#FFD329" accessibilityLabel="Loading saved computer game" />
      )}
      <Modal
        transparent
        visible={confirmNew || Boolean(error)}
        animationType="fade"
        onRequestClose={() => setConfirmNew(false)}
      >
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={styles.dialog} testID="computer-save-dialog">
            <Text style={styles.title}>{confirmNew ? 'Start a new game?' : 'Computer game save'}</Text>
            <Text style={styles.body}>{error ?? (confirmNew ? 'This replaces your saved computer game.' : '')}</Text>
            {error && (
              <Pressable onPress={() => void retry()} style={styles.button}>
                <Text style={styles.buttonText}>Retry</Text>
              </Pressable>
            )}
            {(confirmNew || (!loaded && ownerKnown)) && (
              <Pressable onPress={() => void startNew()} style={styles.button} testID="confirm-new-computer-game">
                <Text style={styles.buttonText}>Start New Game</Text>
              </Pressable>
            )}
            {confirmNew && (
              <Pressable onPress={() => setConfirmNew(false)} style={styles.button}>
                <Text style={styles.buttonText}>Keep Playing</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#961B12', justifyContent: 'center' },
  backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0009' },
  dialog: { backgroundColor: '#FFF3CE', borderRadius: 20, padding: 24, gap: 16 },
  title: { color: '#351005', fontSize: 24, fontWeight: '800' },
  body: { color: '#351005', fontSize: 17 },
  button: { backgroundColor: '#FFD329', borderRadius: 12, padding: 14, alignItems: 'center' },
  buttonText: { color: '#351005', fontSize: 17, fontWeight: '700' },
});
