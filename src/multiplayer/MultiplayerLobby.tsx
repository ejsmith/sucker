import { type ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  type StyleProp,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getComputerStats } from './computerStats';
import { createGameAgainst, listMyGames, removeRemoteGame } from './games';
import { acceptInviteCode, createInviteGame } from './invites';
import { canRegisterWebPush, registerWebPushSubscription } from './notifications';
import { searchProfiles } from './profiles';
import { useMultiplayerSession } from './useMultiplayerSession';
import type { RemoteGameRow } from './types';
import { getPhoneStageStyle } from '../ui/phoneStage';
import { useAppActivity } from '../ui/useAppActivity';

type SearchProfile = Awaited<ReturnType<typeof searchProfiles>>[number];
type ComputerStatsRow = Awaited<ReturnType<typeof getComputerStats>>;
type LobbyPage = 'games' | 'profile' | 'startFriend';
const publicInviteBaseUrl = 'https://sucker.games/invite';
const privacyPolicyUrl = 'https://sucker.games/privacy.html';
const accountDeletionUrl = 'https://sucker.games/account-deletion.html';
const lobbyHeaderImage = require('../../assets/sucker-lobby-header.png');

export function MultiplayerLobby({
  onOpenGame,
  onPlayLocalDemo,
}: {
  onOpenGame: (gameId: string) => void;
  onPlayLocalDemo: () => void;
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
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
  const [webPushEnabled, setWebPushEnabled] = useState(() => Platform.OS === 'web' && canRegisterWebPush());
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState<LobbyPage>('games');
  const shellStyle = getPhoneStageStyle(windowWidth, windowHeight);
  const shellSafeAreaStyle: StyleProp<ViewStyle> = {
    paddingBottom: Math.max(12, safeAreaInsets.bottom + 12),
    paddingTop: Math.max(12, safeAreaInsets.top + 4),
  };

  function renderShell(children: ReactNode) {
    return (
      <View style={lobbyStyles.stageHost}>
        <View style={[lobbyStyles.shell, shellStyle, shellSafeAreaStyle]} testID="multiplayer-lobby-shell">
          {children}
        </View>
      </View>
    );
  }

  useEffect(() => {
    if (session) {
      void refreshGames();
      void refreshComputerStats();
    }

    if (profile) {
      setDisplayName(profile.display_name);
      setUsername(profile.username ?? '');
    }
  }, [profile, session]);

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

  async function refreshGames() {
    const nextGames = await listMyGames();
    setGames(nextGames);
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
      if (result) {
        setWebPushEnabled(false);
        setMessage('Browser notifications enabled.');
      }
    });
  }

  async function handleRemoveGame(gameId: string) {
    await runAction(async () => {
      await removeRemoteGame(gameId);
      setGames((currentGames) => currentGames.filter((game) => game.id !== gameId));
      setMessage('Game removed.');
    });
  }

  async function handleSearchProfiles() {
    await runAction(async () => {
      const results = await searchProfiles(query);
      setSearchResults(results.filter((result) => result.id !== profile?.id));
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
    await Share.share({
      message: `Play Sucker! with me: ${inviteLink}`,
      url: inviteLink,
    });
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
  const playerName = profile?.display_name ?? session.user.email ?? 'player';

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
    <ScrollView
      contentContainerStyle={lobbyStyles.scrollContent}
      showsVerticalScrollIndicator={false}
      style={lobbyStyles.scroll}
    >
      <SuckerLobbyTitle />
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
            onPress={() => void refreshGames()}
            style={({ pressed }) => [lobbyStyles.refreshButton, pressed && lobbyStyles.pressed]}
            testID="refresh-games-button"
          >
            <Text style={lobbyStyles.refreshText}>Refresh</Text>
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
              isBusy={isBusy}
              key={game.id}
              now={now}
              onOpenGame={onOpenGame}
              onRemoveGame={handleRemoveGame}
              profileId={profileId}
            />
          ))
        )}
      </View>

      {webPushEnabled && profile && (
        <Pressable
          disabled={isBusy || isLoading}
          onPress={() => void handleEnableWebNotifications()}
          style={({ pressed }) => [lobbyStyles.notificationButton, pressed && lobbyStyles.pressed]}
        >
          <Text style={lobbyStyles.notificationButtonText}>Enable Turn Notifications</Text>
        </Pressable>
      )}

      <View style={lobbyStyles.actionGrid}>
        <Pressable
          onPress={() => setPage('startFriend')}
          style={({ pressed }) => [lobbyStyles.primaryButton, lobbyStyles.actionButton, pressed && lobbyStyles.pressed]}
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
    </ScrollView>,
  );
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
  profileId,
}: {
  game: RemoteGameRow;
  isBusy: boolean;
  now: number;
  onOpenGame: (gameId: string) => void;
  onRemoveGame: (gameId: string) => Promise<void>;
  profileId: string;
}) {
  const opponent = game.state.players.find((player) => player.id !== profileId);
  const me = game.state.players.find((player) => player.id === profileId);
  const opponentName = opponent?.name ?? (game.status === 'inviting' ? 'Waiting for friend' : 'Opponent');
  const myScore = me ? totalFilledScore(me.scorecard) : 0;
  const opponentScore = opponent ? totalFilledScore(opponent.scorecard) : 0;
  const isMyTurn = game.current_player_id === profileId;
  const status = getGameStatusLabel(game, profileId);
  const waitPrefix = isMyTurn ? `${opponentName} has waited` : 'You have waited';
  const waitText =
    game.status === 'inviting'
      ? `Open invite for ${formatElapsed(now, game.updated_at)}`
      : `${waitPrefix} ${formatElapsed(now, game.updated_at)}`;

  return (
    <View style={[lobbyStyles.gameCard, isMyTurn && lobbyStyles.gameCardMyTurn]} testID={`game-card-${game.id}`}>
      <Pressable
        onPress={() => onOpenGame(game.id)}
        style={({ pressed }) => [lobbyStyles.gameCardPressTarget, pressed && lobbyStyles.pressed]}
        testID={`open-game-${game.id}`}
      >
        <View style={lobbyStyles.gameCardTop}>
          <View style={lobbyStyles.avatarLarge}>
            <Text style={lobbyStyles.avatarLargeText}>{opponentName.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={lobbyStyles.gameSummary}>
            <Text numberOfLines={1} style={lobbyStyles.gameOpponent}>
              {opponentName}
            </Text>
            <Text style={[lobbyStyles.turnBadge, isMyTurn && lobbyStyles.turnBadgeHot]}>{status}</Text>
          </View>
          <View style={lobbyStyles.scorePill}>
            <Text style={lobbyStyles.scorePillText}>{myScore}</Text>
            <Text style={lobbyStyles.scoreDivider}>-</Text>
            <Text style={lobbyStyles.scorePillText}>{opponentScore}</Text>
          </View>
        </View>
        <Text style={lobbyStyles.waitText}>{waitText}</Text>
      </Pressable>
      <Pressable
        disabled={isBusy}
        onPress={() => void onRemoveGame(game.id)}
        style={({ pressed }) => [lobbyStyles.removeGameButton, pressed && lobbyStyles.pressed]}
        testID={`remove-game-${game.id}`}
      >
        <Text style={lobbyStyles.removeGameText}>Remove</Text>
      </Pressable>
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

function getGameStatusLabel(game: RemoteGameRow, profileId: string) {
  if (game.status === 'inviting') {
    return 'Waiting for friend';
  }
  if (game.status === 'blocked_response' && game.current_player_id === profileId) {
    return 'Block or replay';
  }
  if (game.status === 'response_window' && game.current_player_id === profileId) {
    return 'Your response';
  }

  return game.current_player_id === profileId ? 'Your turn' : 'Their turn';
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

function totalFilledScore(scorecard: RemoteGameRow['state']['players'][number]['scorecard']) {
  return Object.values(scorecard).reduce<number>((total, score) => total + (score ?? 0), 0);
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
    borderColor: '#FFD329',
  },
  gameCardPressTarget: {
    gap: 6,
  },
  codeInput: {
    fontSize: 22,
    letterSpacing: 0,
    textAlign: 'center',
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
  heading: {
    color: '#FFF3C2',
    fontSize: 19,
    fontWeight: '900',
    marginBottom: 8,
    textAlign: 'center',
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
  notificationButton: {
    alignItems: 'center',
    backgroundColor: '#3A0A05',
    borderColor: '#FFD329',
    borderRadius: 8,
    borderWidth: 2,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 10,
    width: '100%',
  },
  notificationButtonText: {
    color: '#FFD329',
    fontSize: 13,
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
  refreshButton: {
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
  refreshText: {
    color: '#210505',
    fontSize: 12,
    fontWeight: '900',
  },
  removeGameButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#8F3B10',
    borderColor: '#D89746',
    borderRadius: 6,
    borderWidth: 2,
    height: 30,
    justifyContent: 'center',
    minWidth: 76,
    paddingHorizontal: 8,
  },
  removeGameText: {
    color: '#FFF3C2',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
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
    backgroundColor: '#8F3B10',
    borderRadius: 6,
    color: '#FFF3C2',
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  turnBadgeHot: {
    backgroundColor: '#F12D22',
    color: '#FFD329',
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
