import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  type StyleProp,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getComputerStats } from './computerStats';
import {
  createGameAgainst,
  createRematch,
  listMyGames,
  nudgeRemoteGame,
  removeRemoteGame,
  subscribeToGameListChanges,
} from './games';
import { acceptInviteCode, createInviteGame } from './invites';
import {
  canRegisterWebPush,
  countGamesAwaitingTurn,
  hasWebPushVapidPublicKey,
  registerWebPushSubscription,
  syncAppBadgeCount,
} from './notifications';
import { searchProfiles } from './profiles';
import { useMultiplayerSession } from './useMultiplayerSession';
import type { RemoteGameRow } from './types';
import { categoryLabels, scoreCategories, totalScore, upperBonus } from '../game';
import { getPhoneStageStyle } from '../ui/phoneStage';
import { useAppActivity } from '../ui/useAppActivity';
import { useKeyboardStableWindowDimensions } from '../ui/useKeyboardStableWindowDimensions';

type SearchProfile = Awaited<ReturnType<typeof searchProfiles>>[number];
type ComputerStatsRow = Awaited<ReturnType<typeof getComputerStats>>;
type LobbyPage = 'games' | 'profile' | 'startFriend' | 'completedGames' | 'completedGameDetail';
type WebNotificationPermission = 'default' | 'denied' | 'granted';
const publicInviteBaseUrl = 'https://sucker.games/invite';
const privacyPolicyUrl = 'https://sucker.games/privacy.html';
const accountDeletionUrl = 'https://sucker.games/account-deletion.html';
const webPushPromptDismissedAtKey = 'sucker.webPushPromptDismissedAt';
const webPushPromptSnoozeMs = 7 * 24 * 60 * 60 * 1_000;
const nudgeTurnWaitMs = 60 * 60 * 1_000;
const nudgeCooldownMs = 8 * 60 * 60 * 1_000;
const gameListRemoveActionWidth = 96;
const minimumVisibleRefreshMs = 450;
const pullRefreshMinimumMove = 14;
const pullRefreshTriggerDistance = 44;
const pullRefreshMaxDistance = 72;
const lobbyHeaderImage = require('../../assets/sucker-lobby-header.png');

export function MultiplayerLobby({
  onOpenGame,
  onPlayLocalDemo,
}: {
  onOpenGame: (gameId: string) => void;
  onPlayLocalDemo: () => void;
}) {
  const { height: windowHeight, width: windowWidth } = useKeyboardStableWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const isAppActive = useAppActivity();
  const { endSession, error, isLoading, profile, saveProfile, sendSignInCode, session, verifySignInCode } =
    useMultiplayerSession();
  const [email, setEmail] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [sentCodeEmail, setSentCodeEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [generatedInviteCode, setGeneratedInviteCode] = useState<string | null>(null);
  const [games, setGames] = useState<RemoteGameRow[]>([]);
  const [computerStats, setComputerStats] = useState<ComputerStatsRow>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchProfile[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullRefreshDistance, setPullRefreshDistance] = useState(0);
  const [isPullRefreshActive, setIsPullRefreshActive] = useState(false);
  const [webPushPromptDismissed, setWebPushPromptDismissed] = useState(readWebPushPromptDismissed);
  const [webPushPromptVisible, setWebPushPromptVisible] = useState(false);
  const [removeGameToConfirm, setRemoveGameToConfirm] = useState<RemoteGameRow | null>(null);
  const [selectedCompletedGameId, setSelectedCompletedGameId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState<LobbyPage>('games');
  const gamesScrollY = useRef(0);
  const shellStyle = getPhoneStageStyle(windowWidth, windowHeight);
  const shellSafeAreaStyle: StyleProp<ViewStyle> = {
    paddingBottom: Math.max(12, safeAreaInsets.bottom + 12),
    paddingTop: Math.max(12, safeAreaInsets.top + 4),
  };
  const stageHostStableStyle: StyleProp<ViewStyle> =
    Platform.OS === 'web' ? { minHeight: shellStyle.height, minWidth: shellStyle.width } : null;

  function renderShell(children: ReactNode) {
    return (
      <View style={[lobbyStyles.stageHost, stageHostStableStyle]}>
        <View style={[lobbyStyles.shell, shellStyle, shellSafeAreaStyle]} testID="multiplayer-lobby-shell">
          {children}
        </View>
      </View>
    );
  }

  const refreshGames = useCallback(
    async ({ surfaceError = true }: { surfaceError?: boolean } = {}) => {
      try {
        const nextGames = await listMyGames();
        setGames(nextGames);
        setNow(Date.now());
        await syncAppBadgeCount(profile ? countGamesAwaitingTurn(nextGames, profile.id) : 0);
      } catch (refreshError) {
        if (surfaceError) {
          setMessage(refreshError instanceof Error ? refreshError.message : 'Unable to refresh games.');
        }
      }
    },
    [profile],
  );

  useEffect(() => {
    if (session) {
      void refreshGames();
      void refreshComputerStats();
    }

    if (profile) {
      setDisplayName(profile.display_name);
      setUsername(profile.username ?? '');
    }
  }, [profile, refreshGames, session]);

  useEffect(() => {
    void syncAppBadgeCount(profile ? countGamesAwaitingTurn(games, profile.id) : 0);
  }, [games, profile]);

  useEffect(() => {
    if (!session || !isAppActive) {
      return;
    }

    void refreshGames({ surfaceError: false });
    const unsubscribe = subscribeToGameListChanges(() => void refreshGames({ surfaceError: false }));
    const timer = setInterval(() => void refreshGames({ surfaceError: false }), 15_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [isAppActive, refreshGames, session]);

  useEffect(() => {
    if (!isAppActive) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [isAppActive]);

  useEffect(() => {
    let isMounted = true;

    function handleInviteUrl(url: string | null) {
      const nextInviteCode = getInviteCodeFromUrl(url);
      if (!nextInviteCode || !isMounted) {
        return;
      }

      setInviteCode(nextInviteCode);
      setPage('startFriend');
    }

    void Linking.getInitialURL().then(handleInviteUrl);
    const subscription = Linking.addEventListener('url', (event) => handleInviteUrl(event.url));

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const hasActiveGames = games.some((game) => game.status !== 'complete');
    if (!profile || !hasActiveGames || webPushPromptDismissed || !canOfferWebPushPrompt()) {
      setWebPushPromptVisible(false);
      return;
    }

    setWebPushPromptVisible(getWebNotificationPermission() === 'default');
  }, [games, profile, webPushPromptDismissed]);

  async function runAction(action: () => Promise<void>) {
    setIsBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (actionError) {
      setMessage(actionError instanceof Error ? actionError.message : 'Something went wrong.');
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshComputerStats() {
    const nextStats = await getComputerStats();
    setComputerStats(nextStats);
  }

  async function handleEnableWebNotifications() {
    if (!profile) {
      return;
    }

    await runAction(async () => {
      const result = await registerWebPushSubscription(profile.id);
      setWebPushPromptVisible(false);
      if (result) {
        setMessage('Browser notifications enabled.');
      }
    });
  }

  async function handleVisibleRefreshGames() {
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    try {
      await Promise.all([refreshGames(), waitForVisibleRefresh()]);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handlePullRefreshGesture() {
    setIsPullRefreshActive(true);
    setPullRefreshDistance(42);
    try {
      await handleVisibleRefreshGames();
    } finally {
      setIsPullRefreshActive(false);
      setPullRefreshDistance(0);
    }
  }

  function handleDismissWebPushPrompt() {
    rememberWebPushPromptDismissed();
    setWebPushPromptDismissed(true);
    setWebPushPromptVisible(false);
  }

  async function handleSearchProfiles() {
    await runAction(async () => {
      const results = await searchProfiles(query);
      setSearchResults(results.filter((result) => result.id !== profile?.id));
    });
  }

  function handleRemoveGame(game: RemoteGameRow) {
    setRemoveGameToConfirm(game);
  }

  async function confirmRemoveGame() {
    if (!removeGameToConfirm) {
      return;
    }

    const game = removeGameToConfirm;
    const isInvite = game.status === 'inviting';
    setRemoveGameToConfirm(null);
    await runAction(async () => {
      await removeRemoteGame(game.id);
      setGames((currentGames) => currentGames.filter((currentGame) => currentGame.id !== game.id));
      setMessage(isInvite ? 'Invite removed.' : 'Game removed.');
      await refreshGames({ surfaceError: false });
    });
  }

  async function handleNudgeGame(game: RemoteGameRow) {
    await runAction(async () => {
      await nudgeRemoteGame(game.id);
      setGames((currentGames) =>
        currentGames.map((currentGame) =>
          currentGame.id === game.id ? { ...currentGame, last_nudged_at: new Date().toISOString() } : currentGame,
        ),
      );
      setMessage('Nudge sent.');
      await refreshGames({ surfaceError: false });
    });
  }

  async function handleRematchGame(game: RemoteGameRow) {
    await runAction(async () => {
      await createRematch(game.id);
      await refreshGames({ surfaceError: false });
      setMessage('Rematch sent.');
      setSelectedCompletedGameId(null);
      setPage('games');
    });
  }

  async function handleSendCode() {
    const normalizedEmail = email.trim();
    await runAction(async () => {
      await sendSignInCode(normalizedEmail);
      setSentCodeEmail(normalizedEmail);
      setLoginCode('');
      setMessage('Check your email for your 6-digit Sucker! code.');
    });
  }

  async function handleVerifyCode() {
    const normalizedEmail = (sentCodeEmail ?? email).trim();
    const normalizedCode = loginCode.trim();
    await runAction(async () => {
      await verifySignInCode(normalizedEmail, normalizedCode);
      setMessage(null);
    });
  }

  async function shareInviteLink() {
    if (!generatedInviteCode) {
      return;
    }

    const inviteLink = getInviteLink(generatedInviteCode);
    const inviteMessage = `Play Sucker! with me: ${inviteLink}`;
    setMessage(null);

    try {
      if (Platform.OS === 'web') {
        try {
          const didShare = await shareInviteLinkOnWeb(inviteLink, inviteMessage);
          if (didShare) {
            return;
          }
        } catch (webShareError) {
          if (isWebShareAbort(webShareError)) {
            return;
          }
        }

        await copyTextToWebClipboard(inviteLink);
        setMessage('Invite link copied.');
        return;
      }

      await Share.share({
        message: inviteMessage,
        url: inviteLink,
      });
    } catch (shareError) {
      if (isWebShareAbort(shareError)) {
        return;
      }

      setMessage(shareError instanceof Error ? shareError.message : 'Unable to share invite.');
    }
  }

  if (!session) {
    const isCodeSent = sentCodeEmail !== null;
    const isLoginBusy = isBusy || isLoading;
    const loginMessage = message ?? error;
    const isLoginActionDisabled = isLoginBusy || (isCodeSent ? loginCode.trim().length < 6 : email.trim().length === 0);
    const loginButtonLabel = isLoginBusy
      ? isCodeSent
        ? 'Verifying...'
        : 'Sending...'
      : isCodeSent
        ? 'Verify Code'
        : 'Send Code';

    return renderShell(
      <>
        <SuckerLobbyTitle />
        <View style={lobbyStyles.loginActionGroup}>
          <Text style={lobbyStyles.loginSectionTitle}>Play Friends</Text>
          {isCodeSent && <Text style={lobbyStyles.subtleText}>Code sent to {sentCodeEmail}</Text>}
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            editable={!isCodeSent}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor="#8A4B12"
            style={lobbyStyles.input}
            testID="login-email-input"
            value={email}
          />
          {isCodeSent && (
            <TextInput
              autoCapitalize="none"
              editable={!isLoginBusy}
              autoComplete="one-time-code"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={(value) => setLoginCode(value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Sign-in code"
              placeholderTextColor="#8A4B12"
              style={[lobbyStyles.input, lobbyStyles.codeInput]}
              testID="login-code-input"
              textContentType="oneTimeCode"
              value={loginCode}
            />
          )}
          <Pressable
            disabled={isLoginActionDisabled}
            onPress={() => void (isCodeSent ? handleVerifyCode() : handleSendCode())}
            style={({ pressed }) => [
              lobbyStyles.primaryButton,
              isLoginActionDisabled && lobbyStyles.primaryButtonDisabled,
              pressed && lobbyStyles.pressed,
            ]}
            testID={isCodeSent ? 'verify-code-button' : 'send-code-button'}
          >
            <View style={lobbyStyles.primaryButtonContent}>
              {isLoginBusy && <ActivityIndicator color="#210505" size="small" />}
              <Text style={lobbyStyles.primaryButtonText}>{loginButtonLabel}</Text>
            </View>
          </Pressable>
          {isCodeSent && (
            <View style={lobbyStyles.loginLinksRow}>
              <Pressable
                disabled={isLoginBusy}
                onPress={() => void handleSendCode()}
                style={({ pressed }) => [lobbyStyles.localLink, pressed && lobbyStyles.pressed]}
              >
                <Text style={lobbyStyles.localLinkText}>Resend code</Text>
              </Pressable>
              <Pressable
                disabled={isLoginBusy}
                onPress={() => {
                  setSentCodeEmail(null);
                  setLoginCode('');
                  setMessage(null);
                }}
                style={({ pressed }) => [lobbyStyles.localLink, pressed && lobbyStyles.pressed]}
              >
                <Text style={lobbyStyles.localLinkText}>Different email</Text>
              </Pressable>
            </View>
          )}
          {loginMessage && <Text style={lobbyStyles.message}>{loginMessage}</Text>}
        </View>
        <View style={lobbyStyles.loginDividerRow}>
          <View style={lobbyStyles.loginDivider} />
          <Text style={lobbyStyles.loginDividerText}>or</Text>
          <View style={lobbyStyles.loginDivider} />
        </View>
        <View style={lobbyStyles.loginActionGroup}>
          <Text style={lobbyStyles.loginSectionTitle}>Solo Game</Text>
          <Pressable
            onPress={onPlayLocalDemo}
            style={({ pressed }) => [lobbyStyles.soloButton, pressed && lobbyStyles.pressed]}
            testID="play-computer-button"
          >
            <Text style={lobbyStyles.soloButtonText}>Play Computer</Text>
          </Pressable>
        </View>
      </>,
    );
  }

  const profileId = profile?.id ?? session.user.id;
  const activeGames = sortActiveGames(
    games.filter((game) => game.status !== 'complete'),
    profileId,
  );
  const completedGames = sortCompletedGames(games.filter((game) => game.status === 'complete')).slice(0, 25);
  const selectedCompletedGame = selectedCompletedGameId
    ? games.find((game) => game.id === selectedCompletedGameId && game.status === 'complete')
    : null;
  const playerName = profile?.display_name ?? session.user.email ?? 'player';
  const usesWebPullRefresh = Platform.OS === 'web';
  const pullRefreshReady = pullRefreshDistance >= pullRefreshTriggerDistance;
  const pullRefreshVisible = usesWebPullRefresh && (pullRefreshDistance > 0 || isPullRefreshActive);
  const shouldStartPullRefreshGesture = (gestureState: { dx: number; dy: number }) => {
    if (!usesWebPullRefresh || page !== 'games' || isRefreshing || gamesScrollY.current > 1) {
      return false;
    }

    const pullingDown = gestureState.dy > pullRefreshMinimumMove;
    const mostlyVertical = Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.25;
    return pullingDown && mostlyVertical;
  };
  const gamesPullRefreshResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gestureState) => shouldStartPullRefreshGesture(gestureState),
    onMoveShouldSetPanResponderCapture: (_event, gestureState) => shouldStartPullRefreshGesture(gestureState),
    onPanResponderMove: (_event, gestureState) => {
      const nextDistance = Math.min(pullRefreshMaxDistance, Math.max(0, gestureState.dy * 0.55));
      setPullRefreshDistance(nextDistance);
    },
    onPanResponderRelease: (_event, gestureState) => {
      const releaseDistance = Math.min(pullRefreshMaxDistance, Math.max(0, gestureState.dy * 0.55));
      const shouldRefresh = releaseDistance >= pullRefreshTriggerDistance || gestureState.vy > 0.85;
      if (shouldRefresh) {
        void handlePullRefreshGesture();
        return;
      }

      setIsPullRefreshActive(false);
      setPullRefreshDistance(0);
    },
    onPanResponderTerminate: () => {
      setIsPullRefreshActive(false);
      setPullRefreshDistance(0);
    },
  });

  if (page === 'completedGames') {
    return renderShell(
      <ScrollView
        contentContainerStyle={lobbyStyles.scrollContent}
        refreshControl={
          <RefreshControl
            colors={['#FFD329']}
            onRefresh={() => void handleVisibleRefreshGames()}
            progressBackgroundColor="#210505"
            refreshing={isRefreshing}
            tintColor="#FFD329"
          />
        }
        showsVerticalScrollIndicator={false}
        style={lobbyStyles.scroll}
      >
        <SuckerLobbyTitle />
        <ScreenHeader title="Completed Games" onBack={() => setPage('games')} />

        <View style={lobbyStyles.panel}>
          <View style={lobbyStyles.panelHeader}>
            <Text style={lobbyStyles.sectionTitle}>Last 25</Text>
            <Pressable
              disabled={isRefreshing}
              onPress={() => void handleVisibleRefreshGames()}
              style={({ pressed }) => [
                lobbyStyles.refreshButton,
                isRefreshing && lobbyStyles.refreshButtonRefreshing,
                pressed && !isRefreshing && lobbyStyles.pressed,
              ]}
              testID="refresh-completed-games-button"
            >
              {isRefreshing ? (
                <View style={lobbyStyles.refreshButtonContent}>
                  <ActivityIndicator color="#210505" size="small" />
                  <Text numberOfLines={1} style={lobbyStyles.refreshText}>
                    Refreshing
                  </Text>
                </View>
              ) : (
                <Text numberOfLines={1} style={lobbyStyles.refreshText}>
                  Refresh
                </Text>
              )}
            </Pressable>
          </View>

          {completedGames.length === 0 ? (
            <View style={lobbyStyles.emptyState}>
              <Text style={lobbyStyles.emptyTitle}>No completed games yet</Text>
              <Text style={lobbyStyles.emptyBody}>Finished games with friends will show up here.</Text>
            </View>
          ) : (
            completedGames.map((game) => (
              <CompletedGameListItem
                game={game}
                isBusy={isBusy || isLoading}
                key={game.id}
                onOpenGame={(completedGame) => {
                  setSelectedCompletedGameId(completedGame.id);
                  setPage('completedGameDetail');
                }}
                onRematchGame={handleRematchGame}
                profileId={profileId}
              />
            ))
          )}
        </View>

        {(isBusy || isLoading) && <ActivityIndicator color="#FFD329" />}
        {(message || error) && <Text style={lobbyStyles.message}>{message ?? error}</Text>}
      </ScrollView>,
    );
  }

  if (page === 'completedGameDetail') {
    return renderShell(
      <ScrollView
        contentContainerStyle={lobbyStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        style={lobbyStyles.scroll}
      >
        <SuckerLobbyTitle />
        <ScreenHeader title="Score Card" onBack={() => setPage('completedGames')} />

        {selectedCompletedGame ? (
          <CompletedGameScorecard
            game={selectedCompletedGame}
            isBusy={isBusy || isLoading}
            onRematchGame={handleRematchGame}
            profileId={profileId}
          />
        ) : (
          <View style={lobbyStyles.panel}>
            <View style={lobbyStyles.emptyState}>
              <Text style={lobbyStyles.emptyTitle}>Game not found</Text>
              <Text style={lobbyStyles.emptyBody}>Refresh completed games and try again.</Text>
            </View>
          </View>
        )}

        {(isBusy || isLoading) && <ActivityIndicator color="#FFD329" />}
        {(message || error) && <Text style={lobbyStyles.message}>{message ?? error}</Text>}
      </ScrollView>,
    );
  }

  if (page === 'startFriend') {
    return renderShell(
      <ScrollView
        contentContainerStyle={lobbyStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        style={lobbyStyles.scroll}
      >
        <SuckerLobbyTitle />
        <ScreenHeader title="Start With Friend" onBack={() => setPage('games')} />

        <View style={lobbyStyles.panel}>
          <Text style={lobbyStyles.sectionTitle}>Find By Username</Text>
          <View style={lobbyStyles.row}>
            <TextInput
              autoCapitalize="none"
              onChangeText={setQuery}
              placeholder="Username or name"
              placeholderTextColor="#8A4B12"
              style={[lobbyStyles.input, lobbyStyles.flexInput]}
              testID="profile-search-input"
              value={query}
            />
            <Pressable
              disabled={isBusy || query.trim().length < 2}
              onPress={() => void handleSearchProfiles()}
              style={({ pressed }) => [lobbyStyles.smallButton, pressed && lobbyStyles.pressed]}
              testID="profile-search-button"
            >
              <Text style={lobbyStyles.smallButtonText}>Find</Text>
            </Pressable>
          </View>
          {searchResults.slice(0, 5).map((result) => (
            <View key={result.id} style={lobbyStyles.resultRow}>
              <View style={lobbyStyles.avatarSmall}>
                <Text style={lobbyStyles.avatarSmallText}>{result.display_name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={lobbyStyles.resultTextBlock}>
                <Text numberOfLines={1} style={lobbyStyles.resultName}>
                  {result.display_name}
                </Text>
                {result.username && (
                  <Text numberOfLines={1} style={lobbyStyles.resultUsername}>
                    @{result.username}
                  </Text>
                )}
              </View>
              <Pressable
                disabled={isBusy}
                onPress={() =>
                  void runAction(async () => {
                    await createGameAgainst(result.id);
                    await refreshGames();
                    setMessage(`Game started with ${result.display_name}.`);
                    setPage('games');
                  })
                }
                style={({ pressed }) => [lobbyStyles.smallButton, pressed && lobbyStyles.pressed]}
                testID={`profile-play-${result.id}`}
              >
                <Text style={lobbyStyles.smallButtonText}>Play</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <View style={lobbyStyles.panel}>
          <Text style={lobbyStyles.sectionTitle}>Join By Invite Code</Text>
          <View style={lobbyStyles.row}>
            <TextInput
              autoCapitalize="characters"
              onChangeText={setInviteCode}
              placeholder="Invite code"
              placeholderTextColor="#8A4B12"
              style={[lobbyStyles.input, lobbyStyles.flexInput]}
              testID="invite-code-input"
              value={inviteCode}
            />
            <Pressable
              disabled={isBusy || inviteCode.trim().length === 0}
              onPress={() =>
                void runAction(async () => {
                  await acceptInviteCode(inviteCode);
                  setInviteCode('');
                  await refreshGames();
                  setMessage('Invite accepted.');
                  setPage('games');
                })
              }
              style={({ pressed }) => [lobbyStyles.smallButton, pressed && lobbyStyles.pressed]}
              testID="join-invite-button"
            >
              <Text style={lobbyStyles.smallButtonText}>Join</Text>
            </Pressable>
          </View>
        </View>

        <View style={lobbyStyles.panel}>
          <Text style={lobbyStyles.sectionTitle}>Create Invite Link</Text>
          <Pressable
            disabled={isBusy}
            onPress={() =>
              void runAction(async () => {
                const result = await createInviteGame();
                setGeneratedInviteCode(result.inviteCode ?? null);
                await refreshGames();
              })
            }
            style={({ pressed }) => [lobbyStyles.secondaryButton, pressed && lobbyStyles.pressed]}
            testID="create-invite-button"
          >
            <Text style={lobbyStyles.secondaryButtonText}>Create Link</Text>
          </Pressable>
          {generatedInviteCode && (
            <View style={lobbyStyles.inviteLinkBlock}>
              <Text style={lobbyStyles.inviteCode} testID="generated-invite-code">
                {generatedInviteCode}
              </Text>
              <Text selectable style={lobbyStyles.inviteLinkText}>
                {getInviteLink(generatedInviteCode)}
              </Text>
              <Pressable
                onPress={() => void shareInviteLink()}
                style={({ pressed }) => [lobbyStyles.primaryButton, pressed && lobbyStyles.pressed]}
                testID="share-invite-button"
              >
                <Text style={lobbyStyles.primaryButtonText}>Share Invite</Text>
              </Pressable>
            </View>
          )}
        </View>

        {(isBusy || isLoading) && <ActivityIndicator color="#FFD329" />}
        {(message || error) && <Text style={lobbyStyles.message}>{message ?? error}</Text>}
      </ScrollView>,
    );
  }

  if (page === 'profile') {
    return renderShell(
      <ScrollView
        contentContainerStyle={lobbyStyles.scrollContent}
        refreshControl={
          <RefreshControl
            colors={['#FFD329']}
            onRefresh={() => void handleVisibleRefreshGames()}
            progressBackgroundColor="#210505"
            refreshing={isRefreshing}
            tintColor="#FFD329"
          />
        }
        showsVerticalScrollIndicator={false}
        style={lobbyStyles.scroll}
      >
        <SuckerLobbyTitle />
        <ScreenHeader title="Profile" onBack={() => setPage('games')} />

        <View style={lobbyStyles.panel}>
          <Text style={lobbyStyles.sectionTitle}>Player Info</Text>
          <TextInput
            onChangeText={setDisplayName}
            placeholder="Display name"
            placeholderTextColor="#8A4B12"
            style={lobbyStyles.input}
            testID="display-name-input"
            value={displayName}
          />
          <TextInput
            autoCapitalize="none"
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor="#8A4B12"
            style={lobbyStyles.input}
            testID="username-input"
            value={username}
          />
          <Pressable
            disabled={isBusy || displayName.trim().length === 0}
            onPress={() =>
              void runAction(async () => {
                await saveProfile({
                  displayName: displayName.trim(),
                  username: username.trim() || null,
                });
                setMessage('Profile saved.');
              })
            }
            style={({ pressed }) => [lobbyStyles.primaryButton, pressed && lobbyStyles.pressed]}
            testID="save-profile-button"
          >
            <Text style={lobbyStyles.primaryButtonText}>Save Profile</Text>
          </Pressable>
        </View>

        <ComputerStatsCard stats={computerStats} />

        <View style={lobbyStyles.panel}>
          <Text style={lobbyStyles.sectionTitle}>Account</Text>
          <Pressable
            onPress={() => void Linking.openURL(privacyPolicyUrl)}
            style={({ pressed }) => [lobbyStyles.signOutButton, pressed && lobbyStyles.pressed]}
            testID="privacy-policy-button"
          >
            <Text style={lobbyStyles.signOutText}>Privacy Policy</Text>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(accountDeletionUrl)}
            style={({ pressed }) => [
              lobbyStyles.signOutButton,
              lobbyStyles.deleteAccountButton,
              pressed && lobbyStyles.pressed,
            ]}
            testID="delete-account-button"
          >
            <Text style={[lobbyStyles.signOutText, lobbyStyles.deleteAccountText]}>Delete Account</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => void endSession()}
          style={({ pressed }) => [lobbyStyles.signOutButton, pressed && lobbyStyles.pressed]}
          testID="sign-out-button"
        >
          <Text style={lobbyStyles.signOutText}>Sign Out</Text>
        </Pressable>
        {(isBusy || isLoading) && <ActivityIndicator color="#FFD329" />}
        {(message || error) && <Text style={lobbyStyles.message}>{message ?? error}</Text>}
      </ScrollView>,
    );
  }

  return renderShell(
    <>
      <ScrollView
        alwaysBounceVertical
        bounces
        contentContainerStyle={[lobbyStyles.scrollContent, lobbyStyles.gamesScrollContent]}
        onScroll={(event) => {
          gamesScrollY.current = event.nativeEvent.contentOffset.y;
        }}
        overScrollMode="always"
        refreshControl={
          <RefreshControl
            colors={['#FFD329']}
            onRefresh={() => void handleVisibleRefreshGames()}
            progressBackgroundColor="#210505"
            refreshing={isRefreshing}
            tintColor="#FFD329"
          />
        }
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={[lobbyStyles.scroll, lobbyStyles.gamesScroll]}
        {...(usesWebPullRefresh ? gamesPullRefreshResponder.panHandlers : {})}
      >
        <SuckerLobbyTitle />
        {pullRefreshVisible && (
          <View style={[lobbyStyles.pullRefreshIndicator, { height: Math.max(34, pullRefreshDistance) }]}>
            <ActivityIndicator color="#FFD329" size="small" />
            <Text style={lobbyStyles.pullRefreshText}>
              {isRefreshing ? 'Refreshing' : pullRefreshReady ? 'Release to refresh' : 'Pull to refresh'}
            </Text>
          </View>
        )}
        <View style={lobbyStyles.topBar}>
          <View>
            <Text style={lobbyStyles.welcomeText}>Hi, {playerName}</Text>
            <Text style={lobbyStyles.subtleText}>
              {activeGames.length} active {activeGames.length === 1 ? 'game' : 'games'}
            </Text>
          </View>
          <Pressable
            onPress={() => setPage('profile')}
            style={({ pressed }) => [lobbyStyles.signOutButton, pressed && lobbyStyles.pressed]}
            testID="profile-button"
          >
            <Text style={lobbyStyles.signOutText}>Profile</Text>
          </Pressable>
        </View>

        <View style={lobbyStyles.panel}>
          <View style={lobbyStyles.panelHeader}>
            <Text style={lobbyStyles.sectionTitle}>Games</Text>
            <Pressable
              disabled={isRefreshing}
              onPress={() => void handleVisibleRefreshGames()}
              style={({ pressed }) => [
                lobbyStyles.refreshButton,
                isRefreshing && lobbyStyles.refreshButtonRefreshing,
                pressed && !isRefreshing && lobbyStyles.pressed,
              ]}
              testID="refresh-games-button"
            >
              {isRefreshing ? (
                <View style={lobbyStyles.refreshButtonContent}>
                  <ActivityIndicator color="#210505" size="small" />
                  <Text numberOfLines={1} style={lobbyStyles.refreshText}>
                    Refreshing
                  </Text>
                </View>
              ) : (
                <Text numberOfLines={1} style={lobbyStyles.refreshText}>
                  Refresh
                </Text>
              )}
            </Pressable>
          </View>
          {activeGames.length === 0 ? (
            <View style={lobbyStyles.emptyState}>
              <Text style={lobbyStyles.emptyTitle}>No games yet</Text>
              <Text style={lobbyStyles.emptyBody}>Start one with a friend or play the computer.</Text>
            </View>
          ) : (
            activeGames.map((game) => (
              <GameListItem
                game={game}
                key={game.id}
                now={now}
                onOpenGame={onOpenGame}
                onRemoveGame={handleRemoveGame}
                onNudgeGame={handleNudgeGame}
                profileId={profileId}
                isBusy={isBusy || isLoading}
              />
            ))
          )}
        </View>

        <Pressable
          onPress={() => {
            setSelectedCompletedGameId(null);
            setPage('completedGames');
          }}
          style={({ pressed }) => [lobbyStyles.historyButton, pressed && lobbyStyles.pressed]}
          testID="completed-games-button"
        >
          <View>
            <Text style={lobbyStyles.historyButtonText}>Completed Games</Text>
            <Text style={lobbyStyles.historyButtonMeta}>
              {completedGames.length} recent {completedGames.length === 1 ? 'game' : 'games'}
            </Text>
          </View>
          <Text style={lobbyStyles.historyButtonChevron}>›</Text>
        </Pressable>

        <View style={lobbyStyles.actionGrid}>
          <Pressable
            onPress={() => setPage('startFriend')}
            style={({ pressed }) => [
              lobbyStyles.primaryButton,
              lobbyStyles.actionButton,
              pressed && lobbyStyles.pressed,
            ]}
            testID="start-with-friend-button"
          >
            <Text style={lobbyStyles.primaryButtonText}>Start With Friend</Text>
          </Pressable>
          <Pressable
            onPress={onPlayLocalDemo}
            style={({ pressed }) => [
              lobbyStyles.secondaryButton,
              lobbyStyles.actionButton,
              pressed && lobbyStyles.pressed,
            ]}
            testID="play-computer-button"
          >
            <Text style={lobbyStyles.secondaryButtonText}>Play Computer</Text>
          </Pressable>
        </View>

        {(isBusy || isLoading) && <ActivityIndicator color="#FFD329" />}
        {(message || error) && <Text style={lobbyStyles.message}>{message ?? error}</Text>}
      </ScrollView>

      {webPushPromptVisible && profile && (
        <View style={lobbyStyles.notificationPromptOverlay} testID="turn-notification-prompt">
          <View style={lobbyStyles.notificationPromptCard}>
            <Text style={lobbyStyles.notificationPromptTitle}>Turn notifications?</Text>
            <Text style={lobbyStyles.notificationPromptBody}>Get notified when a friend is waiting on you.</Text>
            <View style={lobbyStyles.notificationPromptActions}>
              <Pressable
                disabled={isBusy || isLoading}
                onPress={handleDismissWebPushPrompt}
                style={({ pressed }) => [lobbyStyles.notificationPromptSecondaryButton, pressed && lobbyStyles.pressed]}
                testID="turn-notification-not-now"
              >
                <Text style={lobbyStyles.notificationPromptSecondaryText}>Not Now</Text>
              </Pressable>
              <Pressable
                disabled={isBusy || isLoading}
                onPress={() => void handleEnableWebNotifications()}
                style={({ pressed }) => [lobbyStyles.notificationPromptPrimaryButton, pressed && lobbyStyles.pressed]}
                testID="turn-notification-enable"
              >
                <Text style={lobbyStyles.notificationPromptPrimaryText}>Enable</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {removeGameToConfirm && (
        <View style={lobbyStyles.notificationPromptOverlay} testID="remove-game-confirmation">
          <View style={lobbyStyles.notificationPromptCard}>
            <Text style={lobbyStyles.notificationPromptTitle}>
              {removeGameToConfirm.status === 'inviting' ? 'Remove invite?' : 'Remove game?'}
            </Text>
            <Text style={lobbyStyles.notificationPromptBody}>{getRemoveGameMessage(removeGameToConfirm)}</Text>
            <View style={lobbyStyles.notificationPromptActions}>
              <Pressable
                disabled={isBusy || isLoading}
                onPress={() => setRemoveGameToConfirm(null)}
                style={({ pressed }) => [lobbyStyles.notificationPromptSecondaryButton, pressed && lobbyStyles.pressed]}
                testID="cancel-remove-game"
              >
                <Text style={lobbyStyles.notificationPromptSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={isBusy || isLoading}
                onPress={() => void confirmRemoveGame()}
                style={({ pressed }) => [
                  lobbyStyles.notificationPromptPrimaryButton,
                  lobbyStyles.removeConfirmButton,
                  pressed && lobbyStyles.pressed,
                ]}
                testID="confirm-remove-game"
              >
                <Text style={lobbyStyles.notificationPromptPrimaryText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </>,
  );
}

async function shareInviteLinkOnWeb(inviteLink: string, inviteMessage: string) {
  const webNavigator = getWebNavigator();
  if (!webNavigator?.share) {
    return false;
  }

  await webNavigator.share({
    text: inviteMessage,
    title: 'Play Sucker!',
    url: inviteLink,
  });
  return true;
}

async function copyTextToWebClipboard(text: string) {
  const webNavigator = getWebNavigator();
  if (!webNavigator?.clipboard?.writeText) {
    throw new Error('Copy is not available in this browser. Select the invite link to copy it.');
  }

  await webNavigator.clipboard.writeText(text);
}

function getWebNavigator() {
  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    (
      globalThis as typeof globalThis & {
        navigator?: Navigator & {
          clipboard?: {
            writeText?: (text: string) => Promise<void>;
          };
          share?: (data: { text?: string; title?: string; url?: string }) => Promise<void>;
        };
      }
    ).navigator ?? null
  );
}

function isWebShareAbort(error: unknown) {
  return Platform.OS === 'web' && error instanceof DOMException && error.name === 'AbortError';
}

function getRemoveGameMessage(game: RemoteGameRow) {
  return game.status === 'inviting'
    ? 'This cancels the open invite and removes it from your games list.'
    : 'This removes the game from your games list. The other player can still see their copy.';
}

function canOfferWebPushPrompt() {
  return Platform.OS === 'web' && canRegisterWebPush() && hasWebPushVapidPublicKey();
}

function getWebNotificationPermission(): WebNotificationPermission {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  return window.Notification.permission;
}

function readWebPushPromptDismissed() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return false;
  }

  const dismissedAt = Number(window.localStorage.getItem(webPushPromptDismissedAtKey));
  return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < webPushPromptSnoozeMs;
}

function rememberWebPushPromptDismissed() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(webPushPromptDismissedAtKey, String(Date.now()));
}

function ScreenHeader({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={lobbyStyles.screenHeader}>
      <Pressable onPress={onBack} style={({ pressed }) => [lobbyStyles.backButton, pressed && lobbyStyles.pressed]}>
        <Text style={lobbyStyles.backButtonText}>‹</Text>
      </Pressable>
      <Text style={lobbyStyles.screenTitle}>{title}</Text>
      <View style={lobbyStyles.backButtonSpacer} />
    </View>
  );
}

function GameListItem({
  game,
  isBusy,
  now,
  onOpenGame,
  onRemoveGame,
  onNudgeGame,
  profileId,
}: {
  game: RemoteGameRow;
  isBusy: boolean;
  now: number;
  onOpenGame: (gameId: string) => void;
  onRemoveGame: (game: RemoteGameRow) => void;
  onNudgeGame: (game: RemoteGameRow) => void;
  profileId: string;
}) {
  const opponent = game.state.players.find((player) => player.id !== profileId);
  const me = game.state.players.find((player) => player.id === profileId);
  const opponentName = opponent?.name ?? (game.status === 'inviting' ? 'Waiting for friend' : 'Opponent');
  const myScore = me ? totalScore(me.scorecard) : 0;
  const opponentScore = opponent ? totalScore(opponent.scorecard) : 0;
  const isMyTurn = game.current_player_id === profileId;
  const nudgeState = getNudgeState(game, profileId, now);
  const status = getGameStatusLabel(game, profileId);
  const waitPrefix = isMyTurn ? `${opponentName} has waited` : 'You have waited';
  const waitText =
    game.status === 'inviting'
      ? `Open invite for ${formatElapsed(now, game.updated_at)}`
      : `${waitPrefix} ${formatElapsed(now, game.updated_at)}`;
  const translateX = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gestureState) =>
        Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4,
      onPanResponderMove: (_event, gestureState) => {
        const nextX = Math.max(-gameListRemoveActionWidth, Math.min(0, gestureState.dx));
        translateX.setValue(nextX);
      },
      onPanResponderRelease: (_event, gestureState) => {
        const shouldOpen = gestureState.dx < -gameListRemoveActionWidth / 2 || gestureState.vx < -0.45;
        Animated.spring(translateX, {
          bounciness: 0,
          speed: 18,
          toValue: shouldOpen ? -gameListRemoveActionWidth : 0,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          bounciness: 0,
          speed: 18,
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={lobbyStyles.swipeGameWrap}>
      <Pressable
        onPress={() => onRemoveGame(game)}
        style={({ pressed }) => [lobbyStyles.swipeRemoveAction, pressed && lobbyStyles.pressed]}
        testID={`remove-game-${game.id}`}
      >
        <Text style={lobbyStyles.swipeRemoveText}>Remove</Text>
      </Pressable>
      <Animated.View
        style={[lobbyStyles.swipeGameContent, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable
          onPress={() => onOpenGame(game.id)}
          style={({ pressed }) => [
            lobbyStyles.gameCard,
            isMyTurn && lobbyStyles.gameCardMyTurn,
            pressed && lobbyStyles.pressed,
          ]}
          testID={`game-card-${game.id}`}
        >
          <View style={lobbyStyles.gameCardTop}>
            <View style={lobbyStyles.avatarLarge}>
              <Text style={lobbyStyles.avatarLargeText}>{opponentName.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={lobbyStyles.gameSummary}>
              <Text numberOfLines={1} style={lobbyStyles.gameOpponent}>
                {opponentName}
              </Text>
              <Text
                style={[
                  lobbyStyles.turnBadge,
                  isMyTurn ? lobbyStyles.turnBadgeYourTurn : status === 'Their turn' && lobbyStyles.turnBadgeTheirTurn,
                ]}
              >
                {status}
              </Text>
            </View>
            <View style={lobbyStyles.gameCardActions}>
              <View style={lobbyStyles.scorePill}>
                <Text style={lobbyStyles.scorePillText}>{myScore}</Text>
                <Text style={lobbyStyles.scoreDivider}>-</Text>
                <Text style={lobbyStyles.scorePillText}>{opponentScore}</Text>
              </View>
              {nudgeState.visible && (
                <Pressable
                  disabled={isBusy || !nudgeState.enabled}
                  onPress={(event) => {
                    event.stopPropagation();
                    onNudgeGame(game);
                  }}
                  style={({ pressed }) => [
                    lobbyStyles.nudgeButton,
                    (!nudgeState.enabled || isBusy) && lobbyStyles.nudgeButtonDisabled,
                    pressed && lobbyStyles.pressed,
                  ]}
                  testID={`nudge-game-${game.id}`}
                >
                  <Text style={lobbyStyles.nudgeButtonText}>{nudgeState.label}</Text>
                </Pressable>
              )}
            </View>
          </View>
          <Text style={lobbyStyles.waitText}>{waitText}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function CompletedGameListItem({
  game,
  isBusy,
  onOpenGame,
  onRematchGame,
  profileId,
}: {
  game: RemoteGameRow;
  isBusy: boolean;
  onOpenGame: (game: RemoteGameRow) => void;
  onRematchGame: (game: RemoteGameRow) => void;
  profileId: string;
}) {
  const { me, opponent } = getGamePlayers(game, profileId);
  const opponentName = opponent?.name ?? 'Opponent';
  const myScore = me ? totalScore(me.scorecard) : 0;
  const opponentScore = opponent ? totalScore(opponent.scorecard) : 0;
  const resultTone = getCompletedResultTone(myScore, opponentScore);

  return (
    <Pressable
      onPress={() => onOpenGame(game)}
      style={({ pressed }) => [
        lobbyStyles.gameCard,
        resultTone === 'win' && lobbyStyles.completedGameWin,
        resultTone === 'loss' && lobbyStyles.completedGameLoss,
        resultTone === 'tie' && lobbyStyles.completedGameTie,
        pressed && lobbyStyles.pressed,
      ]}
      testID={`completed-game-${game.id}`}
    >
      <View style={lobbyStyles.gameCardTop}>
        <View style={lobbyStyles.avatarLarge}>
          <Text style={lobbyStyles.avatarLargeText}>{opponentName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={lobbyStyles.gameSummary}>
          <Text numberOfLines={1} style={lobbyStyles.gameOpponent}>
            {opponentName}
          </Text>
          <Text
            style={[
              lobbyStyles.resultBadge,
              resultTone === 'win' && lobbyStyles.resultBadgeWin,
              resultTone === 'loss' && lobbyStyles.resultBadgeLoss,
              resultTone === 'tie' && lobbyStyles.resultBadgeTie,
            ]}
          >
            {getCompletedResultLabel(myScore, opponentScore)}
          </Text>
        </View>
        <View
          style={[
            lobbyStyles.scorePill,
            resultTone === 'win' && lobbyStyles.completedScorePillWin,
            resultTone === 'loss' && lobbyStyles.completedScorePillLoss,
            resultTone === 'tie' && lobbyStyles.completedScorePillTie,
          ]}
        >
          <Text style={lobbyStyles.scorePillText}>{myScore}</Text>
          <Text style={lobbyStyles.scoreDivider}>-</Text>
          <Text style={lobbyStyles.scorePillText}>{opponentScore}</Text>
        </View>
      </View>
      <View style={lobbyStyles.completedGameFooter}>
        <Text numberOfLines={1} style={lobbyStyles.waitText}>
          {formatCompletedDate(game.completed_at ?? game.updated_at)}
        </Text>
        <Pressable
          disabled={isBusy}
          onPress={(event) => {
            event.stopPropagation();
            onRematchGame(game);
          }}
          style={({ pressed }) => [lobbyStyles.completedRematchButton, pressed && lobbyStyles.pressed]}
          testID={`rematch-completed-game-${game.id}`}
        >
          <Text style={lobbyStyles.completedRematchText}>Rematch</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function CompletedGameScorecard({
  game,
  isBusy,
  onRematchGame,
  profileId,
}: {
  game: RemoteGameRow;
  isBusy: boolean;
  onRematchGame: (game: RemoteGameRow) => void;
  profileId: string;
}) {
  const { me, opponent } = getGamePlayers(game, profileId);
  if (!me || !opponent) {
    return (
      <View style={lobbyStyles.panel}>
        <View style={lobbyStyles.emptyState}>
          <Text style={lobbyStyles.emptyTitle}>Scorecard unavailable</Text>
          <Text style={lobbyStyles.emptyBody}>This completed game is missing player data.</Text>
        </View>
      </View>
    );
  }

  const myScore = totalScore(me.scorecard);
  const opponentScore = totalScore(opponent.scorecard);
  const resultTone = getCompletedResultTone(myScore, opponentScore);

  return (
    <View
      style={[
        lobbyStyles.panel,
        resultTone === 'win' && lobbyStyles.completedDetailWin,
        resultTone === 'loss' && lobbyStyles.completedDetailLoss,
        resultTone === 'tie' && lobbyStyles.completedDetailTie,
      ]}
    >
      <View style={lobbyStyles.completedScoreHeader}>
        <View style={lobbyStyles.completedScoreTitleBlock}>
          <Text numberOfLines={1} style={lobbyStyles.completedScoreTitle}>
            Vs {opponent.name}
          </Text>
          <Text style={lobbyStyles.completedScoreDate}>
            {formatCompletedDate(game.completed_at ?? game.updated_at)}
          </Text>
        </View>
        <Text
          style={[
            lobbyStyles.resultBadge,
            resultTone === 'win' && lobbyStyles.resultBadgeWin,
            resultTone === 'loss' && lobbyStyles.resultBadgeLoss,
            resultTone === 'tie' && lobbyStyles.resultBadgeTie,
          ]}
        >
          {getCompletedResultLabel(myScore, opponentScore)}
        </Text>
      </View>

      <View style={lobbyStyles.statGrid}>
        <StatTile label="You" value={String(myScore)} />
        <StatTile label="Them" value={String(opponentScore)} />
      </View>

      <View style={lobbyStyles.scorecardTable}>
        <View style={[lobbyStyles.scorecardRow, lobbyStyles.scorecardHeaderRow]}>
          <Text style={[lobbyStyles.scorecardCategoryText, lobbyStyles.scorecardHeaderText]}>Category</Text>
          <Text style={[lobbyStyles.scorecardValueText, lobbyStyles.scorecardHeaderText]}>You</Text>
          <Text style={[lobbyStyles.scorecardValueText, lobbyStyles.scorecardHeaderText]}>Them</Text>
        </View>
        {scoreCategories.map((category) => (
          <ScorecardComparisonRow
            key={category}
            label={categoryLabels[category]}
            themValue={formatScorecardScore(opponent.scorecard[category])}
            youValue={formatScorecardScore(me.scorecard[category])}
          />
        ))}
        <ScorecardComparisonRow
          emphasized
          label="Upper bonus"
          themValue={String(upperBonus(opponent.scorecard))}
          youValue={String(upperBonus(me.scorecard))}
        />
        <ScorecardComparisonRow emphasized label="Total" themValue={String(opponentScore)} youValue={String(myScore)} />
      </View>

      <Pressable
        disabled={isBusy}
        onPress={() => void onRematchGame(game)}
        style={({ pressed }) => [
          lobbyStyles.primaryButton,
          isBusy && lobbyStyles.primaryButtonDisabled,
          pressed && lobbyStyles.pressed,
        ]}
        testID={`rematch-completed-detail-${game.id}`}
      >
        <Text style={lobbyStyles.primaryButtonText}>Rematch</Text>
      </Pressable>
    </View>
  );
}

function ScorecardComparisonRow({
  emphasized = false,
  label,
  themValue,
  youValue,
}: {
  emphasized?: boolean;
  label: string;
  themValue: string;
  youValue: string;
}) {
  return (
    <View style={[lobbyStyles.scorecardRow, emphasized && lobbyStyles.scorecardTotalRow]}>
      <Text numberOfLines={1} style={[lobbyStyles.scorecardCategoryText, emphasized && lobbyStyles.scorecardTotalText]}>
        {label}
      </Text>
      <Text style={[lobbyStyles.scorecardValueText, emphasized && lobbyStyles.scorecardTotalText]}>{youValue}</Text>
      <Text style={[lobbyStyles.scorecardValueText, emphasized && lobbyStyles.scorecardTotalText]}>{themValue}</Text>
    </View>
  );
}

function ComputerStatsCard({ stats }: { stats: ComputerStatsRow }) {
  if (!stats || stats.games_played === 0) {
    return (
      <View style={lobbyStyles.panel}>
        <Text style={lobbyStyles.sectionTitle}>Vs Computer</Text>
        <View style={lobbyStyles.emptyState}>
          <Text style={lobbyStyles.emptyTitle}>No computer games yet</Text>
          <Text style={lobbyStyles.emptyBody}>Finished local computer games will be tracked here.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={lobbyStyles.panel}>
      <Text style={lobbyStyles.sectionTitle}>Vs Computer</Text>
      <View style={lobbyStyles.statGrid}>
        <StatTile label="Record" value={`${stats.wins}-${stats.losses}`} />
        <StatTile label="Games" value={String(stats.games_played)} />
        <StatTile label="Avg" value={String(stats.average_score)} />
        <StatTile label="High" value={String(stats.highest_score)} />
      </View>
      <View style={lobbyStyles.statRow}>
        <Text style={lobbyStyles.statLine}>Upper bonus {formatPct(stats.upper_bonus_games, stats.games_played)}</Text>
        <Text style={lobbyStyles.statLine}>Sucker {formatPct(stats.sucker_games, stats.games_played)}</Text>
      </View>
      <View style={lobbyStyles.statRow}>
        <Text style={lobbyStyles.statLine}>3x {formatPct(stats.three_of_a_kind_games, stats.games_played)}</Text>
        <Text style={lobbyStyles.statLine}>4x {formatPct(stats.four_of_a_kind_games, stats.games_played)}</Text>
      </View>
      <View style={lobbyStyles.statRow}>
        <Text style={lobbyStyles.statLine}>Full {formatPct(stats.full_house_games, stats.games_played)}</Text>
        <Text style={lobbyStyles.statLine}>
          Straights {formatPct(stats.small_straight_games + stats.large_straight_games, stats.games_played)}
        </Text>
      </View>
      <View style={lobbyStyles.statRow}>
        <Text style={lobbyStyles.statLine}>Extra rolls {stats.extra_rolls_used ?? 0}</Text>
        <Text style={lobbyStyles.statLine}>Mulligans {stats.mulligans_used ?? 0}</Text>
      </View>
      <View style={lobbyStyles.statRow}>
        <Text style={lobbyStyles.statLine}>Blowouts {stats.blowout_wins ?? 0}</Text>
        <Text style={lobbyStyles.statLine}>Comebacks {stats.comeback_wins ?? 0}</Text>
      </View>
      <View style={lobbyStyles.statRow}>
        <Text style={lobbyStyles.statLine}>Punches {stats.sucker_punches_used ?? 0}</Text>
        <Text style={lobbyStyles.statLine}>Blocks {stats.sucker_blockers_used ?? 0}</Text>
      </View>
      <View style={lobbyStyles.statRow}>
        <Text style={lobbyStyles.statLine}>Hunts {stats.sucker_hunts ?? 0}</Text>
        <Text style={lobbyStyles.statLine}>Misses {stats.sucker_hunt_misses ?? 0}</Text>
      </View>
      <View style={lobbyStyles.statRow}>
        <Text style={lobbyStyles.statLine}>Avg used {formatNumber(stats.average_sucker_tokens_spent ?? 0)}</Text>
        <Text style={lobbyStyles.statLine}>Avg left {formatNumber(stats.average_sucker_tokens_leftover ?? 0)}</Text>
      </View>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={lobbyStyles.statTile}>
      <Text style={lobbyStyles.statValue}>{value}</Text>
      <Text style={lobbyStyles.statLabel}>{label}</Text>
    </View>
  );
}

function sortActiveGames(games: RemoteGameRow[], profileId: string) {
  return [...games].sort((left, right) => {
    const leftTurnRank = left.current_player_id === profileId ? 0 : 1;
    const rightTurnRank = right.current_player_id === profileId ? 0 : 1;
    if (leftTurnRank !== rightTurnRank) {
      return leftTurnRank - rightTurnRank;
    }

    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

function sortCompletedGames(games: RemoteGameRow[]) {
  return [...games].sort((left, right) => getCompletedGameTime(right) - getCompletedGameTime(left));
}

function getCompletedGameTime(game: RemoteGameRow) {
  return new Date(game.completed_at ?? game.updated_at).getTime();
}

function getGamePlayers(game: RemoteGameRow, profileId: string) {
  const me = game.state.players.find((player) => player.id === profileId) ?? null;
  const opponent = game.state.players.find((player) => player.id !== profileId) ?? null;
  return { me, opponent };
}

function getCompletedResultLabel(myScore: number, opponentScore: number) {
  if (myScore === opponentScore) {
    return 'Tie';
  }

  return myScore > opponentScore ? 'You won' : 'You lost';
}

function getCompletedResultTone(myScore: number, opponentScore: number) {
  if (myScore === opponentScore) {
    return 'tie';
  }

  return myScore > opponentScore ? 'win' : 'loss';
}

function getGameStatusLabel(game: RemoteGameRow, profileId: string) {
  if (game.status === 'inviting') {
    return 'Waiting for friend';
  }

  return game.current_player_id === profileId ? 'Your turn' : 'Their turn';
}

function getNudgeState(game: RemoteGameRow, profileId: string, now: number) {
  if (game.status === 'inviting' || game.status === 'complete' || !game.current_player_id) {
    return { enabled: false, label: 'Nudge', visible: false };
  }
  if (game.current_player_id === profileId) {
    return { enabled: false, label: 'Nudge', visible: false };
  }

  const turnAgeMs = Math.max(0, now - new Date(game.updated_at).getTime());
  const waitRemainingMs = Math.max(0, nudgeTurnWaitMs - turnAgeMs);
  const lastNudgedAt = game.last_nudged_at ? new Date(game.last_nudged_at).getTime() : 0;
  const cooldownRemainingMs = lastNudgedAt ? Math.max(0, nudgeCooldownMs - (now - lastNudgedAt)) : 0;
  if (Math.max(waitRemainingMs, cooldownRemainingMs) > 0) {
    return { enabled: false, label: 'Nudge', visible: true };
  }

  return { enabled: true, label: 'Nudge', visible: true };
}

function formatElapsed(now: number, updatedAt: string) {
  const elapsedMs = Math.max(0, now - new Date(updatedAt).getTime());
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) {
    return 'just now';
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h`;
  }

  return `${Math.floor(elapsedHours / 24)}d`;
}

function waitForVisibleRefresh() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, minimumVisibleRefreshMs);
  });
}

function formatPct(count: number, gamesPlayed: number) {
  if (gamesPlayed === 0) {
    return '0%';
  }

  return `${Math.round((count / gamesPlayed) * 100)}%`;
}

function formatNumber(value: number) {
  return Number(value).toFixed(2).replace(/\.00$/, '');
}

function formatScorecardScore(value: number | null) {
  return value === null ? '-' : String(value);
}

function formatCompletedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Completed game';
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getInviteLink(inviteCode: string) {
  return `${publicInviteBaseUrl}/${inviteCode.trim().toUpperCase()}`;
}

function getInviteCodeFromUrl(url: string | null) {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const queryInviteCode = parsedUrl.searchParams.get('invite');
    if (queryInviteCode) {
      return queryInviteCode.trim().toUpperCase();
    }

    if (parsedUrl.protocol === 'sucker:' && parsedUrl.hostname === 'invite') {
      return parsedUrl.pathname.replace(/^\//, '').trim().toUpperCase() || null;
    }

    if (parsedUrl.hostname === 'sucker.games') {
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      if (pathParts[0] === 'invite' && pathParts[1]) {
        return pathParts[1].trim().toUpperCase();
      }
    }
  } catch {
    return null;
  }

  return null;
}

function SuckerLobbyTitle() {
  return (
    <View style={lobbyStyles.iconTitleWrap}>
      <Image source={lobbyHeaderImage} style={lobbyStyles.iconTitleImage} />
    </View>
  );
}

const lobbyStyles = StyleSheet.create({
  actionButton: {
    flex: 1,
    height: 60,
  },
  actionGrid: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  avatarLarge: {
    alignItems: 'center',
    backgroundColor: '#FFD76B',
    borderColor: '#FFF3C2',
    borderRadius: 24,
    borderWidth: 3,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarLargeText: {
    color: '#8F0000',
    fontSize: 24,
    fontWeight: '900',
  },
  avatarSmall: {
    alignItems: 'center',
    backgroundColor: '#FFD76B',
    borderColor: '#FFF3C2',
    borderRadius: 16,
    borderWidth: 2,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  avatarSmallText: {
    color: '#8F0000',
    fontSize: 15,
    fontWeight: '900',
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 8,
    borderWidth: 3,
    height: 38,
    justifyContent: 'center',
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
    width: 42,
  },
  backButtonSpacer: {
    width: 42,
  },
  backButtonText: {
    color: '#210505',
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 36,
  },
  deleteAccountButton: {
    backgroundColor: '#3A0A05',
    borderColor: '#FFB000',
    width: '100%',
  },
  deleteAccountText: {
    color: '#FFF3C2',
  },
  divider: {
    backgroundColor: '#8F3B10',
    height: 2,
    opacity: 0.7,
    width: '100%',
  },
  emptyBody: {
    color: '#FFF3C2',
    fontSize: 13,
    fontWeight: '800',
    opacity: 0.85,
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    padding: 12,
  },
  emptyTitle: {
    color: '#FFD329',
    fontSize: 17,
    fontWeight: '900',
  },
  flexInput: {
    flex: 1,
  },
  gameCard: {
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 3,
    gap: 6,
    padding: 8,
  },
  gameCardMyTurn: {
    backgroundColor: '#FFF8D5',
    borderColor: '#FFD329',
    shadowColor: '#5A1308',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 0,
  },
  gameCardActions: {
    alignItems: 'flex-end',
    gap: 4,
  },
  codeInput: {
    fontSize: 22,
    letterSpacing: 0,
    textAlign: 'center',
  },
  completedGameFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  completedGameLoss: {
    backgroundColor: '#FFE2D6',
    borderColor: '#C62B22',
  },
  completedGameTie: {
    backgroundColor: '#FFF3C2',
    borderColor: '#B97812',
  },
  completedGameWin: {
    backgroundColor: '#F1FFD8',
    borderColor: '#2F8F3E',
  },
  completedDetailLoss: {
    borderColor: '#F05A4A',
  },
  completedDetailTie: {
    borderColor: '#FFB000',
  },
  completedDetailWin: {
    borderColor: '#7DD957',
  },
  completedRematchButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 8,
    borderWidth: 3,
    height: 40,
    justifyContent: 'center',
    minWidth: 92,
    paddingHorizontal: 10,
  },
  completedRematchText: {
    color: '#210505',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  completedScoreDate: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '800',
    opacity: 0.86,
  },
  completedScoreHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  completedScoreTitle: {
    color: '#FFD329',
    fontSize: 19,
    fontWeight: '900',
  },
  completedScoreTitleBlock: {
    flex: 1,
    gap: 2,
  },
  gameCardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  gameLine: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
  gameOpponent: {
    color: '#210505',
    fontSize: 17,
    fontWeight: '900',
  },
  gameSummary: {
    flex: 1,
    gap: 3,
  },
  gamesScroll: {
    flex: 1,
  },
  gamesScrollContent: {
    flexGrow: 1,
  },
  heading: {
    color: '#FFF3C2',
    fontSize: 19,
    fontWeight: '900',
    marginBottom: 8,
    textAlign: 'center',
  },
  historyButton: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: '100%',
  },
  historyButtonChevron: {
    color: '#FFD329',
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 30,
  },
  historyButtonMeta: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '800',
    opacity: 0.82,
  },
  historyButtonText: {
    color: '#FFD329',
    fontSize: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    color: '#210505',
    fontSize: 16,
    fontWeight: '800',
    height: 42,
    paddingHorizontal: 10,
    width: '100%',
  },
  inviteCode: {
    color: '#FFD329',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
    textShadowColor: '#050505',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  inviteLinkBlock: {
    gap: 8,
    width: '100%',
  },
  inviteLinkText: {
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    color: '#210505',
    fontSize: 13,
    fontWeight: '800',
    padding: 8,
    textAlign: 'center',
  },
  localLink: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  localLinkText: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '900',
  },
  loginActionGroup: {
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    gap: 8,
    padding: 10,
    width: '100%',
  },
  loginDivider: {
    backgroundColor: '#FFB000',
    flex: 1,
    height: 2,
    opacity: 0.7,
  },
  loginDividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  loginDividerText: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  loginLinksRow: {
    flexDirection: 'row',
    gap: 14,
  },
  loginSectionTitle: {
    color: '#FFD329',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  message: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  notificationPromptActions: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  notificationPromptBody: {
    color: '#FFF3C2',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  notificationPromptCard: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    gap: 10,
    maxWidth: 330,
    padding: 14,
    width: '100%',
  },
  notificationPromptOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(33, 5, 5, 0.72)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 16,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  notificationPromptPrimaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 8,
    borderWidth: 3,
    flex: 1,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  notificationPromptPrimaryText: {
    color: '#210505',
    fontSize: 16,
    fontWeight: '900',
  },
  notificationPromptSecondaryButton: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    flex: 1,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  notificationPromptSecondaryText: {
    color: '#FFF3C2',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  notificationPromptTitle: {
    color: '#FFD329',
    fontSize: 21,
    fontWeight: '900',
    textAlign: 'center',
  },
  nudgeButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 8,
    borderWidth: 3,
    height: 44,
    justifyContent: 'center',
    minWidth: 96,
    paddingHorizontal: 10,
  },
  nudgeButtonDisabled: {
    opacity: 0.55,
  },
  nudgeButtonText: {
    color: '#210505',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  panel: {
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    gap: 6,
    padding: 8,
    width: '100%',
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pressed: {
    opacity: 0.72,
  },
  pullRefreshIndicator: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  pullRefreshText: {
    color: '#FFD329',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 10,
    borderWidth: 3,
    height: 60,
    justifyContent: 'center',
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
    width: '100%',
  },
  primaryButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.62,
  },
  primaryButtonText: {
    color: '#210505',
    fontSize: 18,
    fontWeight: '900',
  },
  resultName: {
    color: '#FFF3C2',
    fontSize: 14,
    fontWeight: '900',
  },
  resultRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 34,
  },
  resultTextBlock: {
    flex: 1,
  },
  resultUsername: {
    color: '#FFD76B',
    fontSize: 11,
    fontWeight: '800',
  },
  removeConfirmButton: {
    backgroundColor: '#B61C14',
  },
  refreshButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 8,
    borderWidth: 3,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
    width: 116,
  },
  refreshButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  refreshButtonRefreshing: {
    opacity: 0.88,
  },
  refreshText: {
    color: '#210505',
    fontSize: 12,
    fontWeight: '900',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  scorecardCategoryText: {
    color: '#FFF3C2',
    flex: 1,
    fontSize: 12,
    fontWeight: '900',
  },
  scorecardHeaderRow: {
    backgroundColor: '#8F3B10',
    borderBottomWidth: 0,
  },
  scorecardHeaderText: {
    color: '#FFD329',
    fontSize: 11,
    textTransform: 'uppercase',
  },
  scorecardRow: {
    alignItems: 'center',
    borderBottomColor: '#8F3B10',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  scorecardTable: {
    backgroundColor: '#3A0A05',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    overflow: 'hidden',
    width: '100%',
  },
  scorecardTotalRow: {
    backgroundColor: '#FFF3C2',
    borderBottomWidth: 0,
  },
  scorecardTotalText: {
    color: '#210505',
    fontSize: 13,
  },
  scorecardValueText: {
    color: '#FFF3C2',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    width: 54,
  },
  screenHeader: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
    width: '100%',
  },
  screenTitle: {
    color: '#FFD329',
    fontSize: 17,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 10,
    borderWidth: 3,
    height: 60,
    justifyContent: 'center',
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
  },
  secondaryButtonText: {
    color: '#210505',
    fontSize: 16,
    fontWeight: '900',
  },
  sectionTitle: {
    color: '#FFD329',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  scoreDivider: {
    color: '#8F3B10',
    fontSize: 15,
    fontWeight: '900',
  },
  scorePill: {
    alignItems: 'center',
    backgroundColor: '#FFD76B',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 4,
    minWidth: 72,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  scorePillText: {
    color: '#210505',
    fontSize: 18,
    fontWeight: '900',
  },
  completedScorePillLoss: {
    backgroundColor: '#FFB6A6',
    borderColor: '#C62B22',
  },
  completedScorePillTie: {
    backgroundColor: '#FFE08A',
    borderColor: '#B97812',
  },
  completedScorePillWin: {
    backgroundColor: '#DFF7A8',
    borderColor: '#2F8F3E',
  },
  scroll: {
    width: '100%',
  },
  scrollContent: {
    alignItems: 'center',
    gap: 8,
    paddingBottom: 18,
    paddingTop: 8,
  },
  shell: {
    alignItems: 'center',
    backgroundColor: '#8F0000',
    gap: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 12,
  },
  stageHost: {
    alignItems: 'center',
    backgroundColor: '#8F0000',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  signOutButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 8,
    borderWidth: 3,
    height: 34,
    justifyContent: 'center',
    minWidth: 76,
    paddingHorizontal: 10,
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
  },
  signOutText: {
    color: '#210505',
    fontSize: 12,
    fontWeight: '900',
  },
  smallButton: {
    alignItems: 'center',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    borderRadius: 8,
    borderWidth: 3,
    height: 42,
    justifyContent: 'center',
    minWidth: 68,
    paddingHorizontal: 10,
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
  },
  smallButtonText: {
    color: '#210505',
    fontSize: 14,
    fontWeight: '900',
  },
  soloButton: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#FFD329',
    borderRadius: 10,
    borderWidth: 2,
    height: 54,
    justifyContent: 'center',
    shadowColor: '#050505',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
    width: '100%',
  },
  soloButtonText: {
    color: '#FFD329',
    fontSize: 17,
    fontWeight: '900',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  statLabel: {
    color: '#8F3B10',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  statLine: {
    color: '#FFF3C2',
    flex: 1,
    fontSize: 12,
    fontWeight: '900',
  },
  statRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statTile: {
    alignItems: 'center',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
    borderRadius: 8,
    borderWidth: 2,
    flex: 1,
    paddingVertical: 6,
  },
  statValue: {
    color: '#210505',
    fontSize: 18,
    fontWeight: '900',
  },
  swipeGameContent: {
    width: '100%',
  },
  swipeGameWrap: {
    borderRadius: 8,
    overflow: 'hidden',
    width: '100%',
  },
  swipeRemoveAction: {
    alignItems: 'center',
    backgroundColor: '#B61C14',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: 0,
    width: gameListRemoveActionWidth,
  },
  swipeRemoveText: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  subtleText: {
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '800',
    opacity: 0.85,
  },
  iconTitleImage: {
    height: 122,
    resizeMode: 'contain',
    width: '100%',
  },
  iconTitleWrap: {
    alignItems: 'center',
    height: 128,
    justifyContent: 'center',
    width: '100%',
  },
  topBar: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFB000',
    borderRadius: 8,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    width: '100%',
  },
  turnBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#5A1308',
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#8F3B10',
    color: '#D9A25B',
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  turnBadgeTheirTurn: {
    backgroundColor: '#5A1308',
    borderColor: '#8F3B10',
    color: '#D9A25B',
  },
  turnBadgeYourTurn: {
    backgroundColor: '#F12D22',
    borderColor: '#FFD329',
    color: '#FFF3C2',
    textShadowColor: '#7A1208',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  resultBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 2,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  resultBadgeLoss: {
    backgroundColor: '#C62B22',
    borderColor: '#7A1208',
    color: '#FFF3C2',
  },
  resultBadgeTie: {
    backgroundColor: '#FFE08A',
    borderColor: '#B97812',
    color: '#5A1308',
  },
  resultBadgeWin: {
    backgroundColor: '#7DD957',
    borderColor: '#2F8F3E',
    color: '#183B12',
  },
  waitText: {
    color: '#8F3B10',
    fontSize: 12,
    fontWeight: '900',
  },
  welcomeText: {
    color: '#FFD329',
    fontSize: 16,
    fontWeight: '900',
  },
});
