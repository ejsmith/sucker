import { useEffect, useRef, useState, type Ref } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { categoryLabels, type PartingShot, type Player } from '../game';
import type { PlayerGameRecap, ScoredBox } from '../../shared/gameRecap';
import { getPartingShotText, type PartingShotLineId, type PartingShotOptions } from '../../shared/partingShots';
import type { PlayerRecapResult, RecapFeat, RemoteGameRecap } from '../multiplayer/gameRecap';
import { focusAccessibilityTarget, type AccessibilityTargetRef } from './accessibilityFocus';
import { BackChevronIcon } from './ControlIcon';
import { Pressable } from './Pressable';

const maxFontSizeMultiplier = 1.2;
const black = 'Inter_900Black';
const extraBold = 'Inter_800ExtraBold';
type Unit = (value: number) => number;

type Highlight = RecapFeat & { owner: string; ownerId: string };

// Your feats, then theirs, then your defeats, then theirs.
export function getRecapHighlights(recap: RemoteGameRecap, home: Player, opponent: Player): Highlight[] {
  const owned = (player: Player, tone: RecapFeat['tone']) =>
    (recap.results[player.id]?.feats ?? [])
      .filter((feat) => feat.tone === tone)
      .map((feat) => ({ ...feat, owner: player.id === home.id ? 'You' : player.name, ownerId: player.id }));
  return [...owned(home, 'feat'), ...owned(opponent, 'feat'), ...owned(home, 'defeat'), ...owned(opponent, 'defeat')];
}

// "▲ 20 · 1220" under a Game Over score.
export function RatingChange({ result, unit }: { result: PlayerRecapResult | undefined; unit: Unit }) {
  if (result?.ratingBefore == null || result.ratingAfter == null) return null;
  const after = Math.round(result.ratingAfter);
  const change = after - Math.round(result.ratingBefore);
  const up = change >= 0;

  return (
    <Text
      accessibilityLabel={`Rating ${up ? 'up' : 'down'} ${Math.abs(change)} to ${after}`}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      numberOfLines={1}
      style={[
        styles.rating,
        up ? styles.ratingUp : styles.ratingDown,
        { borderRadius: unit(8), fontSize: unit(11), paddingHorizontal: unit(6), paddingVertical: unit(1) },
      ]}
      testID="game-over-rating"
    >
      {up ? '▲' : '▼'} {Math.abs(change)} · {after}
    </Text>
  );
}

function FeatBadge({ size, tone }: { size: number; tone: RecapFeat['tone'] }) {
  return (
    <View
      style={[
        styles.badge,
        tone === 'feat' ? styles.badgeFeat : styles.badgeDefeat,
        { borderRadius: size / 2, height: size, width: size },
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[styles.badgeText, tone === 'defeat' && styles.badgeTextDefeat, { fontSize: size * 0.55 }]}
      >
        {tone === 'feat' ? '★' : '✕'}
      </Text>
    </View>
  );
}

// The Game Over panel's short list: the three best things that happened, with
// the rest one tap away in the recap.
export function GameOverHighlights({
  home,
  maxShown,
  onOpenRecap,
  opponent,
  recap,
  recapFailed,
  unit,
}: {
  home: Player;
  maxShown: number;
  onOpenRecap: () => void;
  opponent: Player;
  recap: RemoteGameRecap | null;
  recapFailed: boolean;
  unit: Unit;
}) {
  const highlights = recap ? getRecapHighlights(recap, home, opponent) : [];
  const shown = highlights.slice(0, maxShown);
  const hidden = highlights.length - shown.length;

  return (
    <View style={[styles.highlights, { gap: unit(6) }]} testID="game-recap-highlights">
      <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.label, { fontSize: unit(11) }]}>
        HIGHLIGHTS
      </Text>
      {!recap ? (
        <Text
          maxFontSizeMultiplier={maxFontSizeMultiplier}
          style={[styles.quiet, { fontSize: unit(12) }]}
          testID="game-recap-loading"
        >
          {recapFailed ? 'The recap got lost in the mail.' : 'Tallying the damage…'}
        </Text>
      ) : shown.length === 0 ? (
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.quiet, { fontSize: unit(12) }]}>
          Nothing to brag about. Nothing to hide.
        </Text>
      ) : (
        shown.map((highlight) => (
          <View
            accessibilityLabel={`${highlight.owner}, ${highlight.tone === 'feat' ? 'feat' : 'defeat'}: ${highlight.name}. ${highlight.description}`}
            accessible
            key={`${highlight.ownerId}-${highlight.key}`}
            style={[styles.highlightRow, { gap: unit(8) }]}
            testID={`game-recap-highlight-${highlight.key}`}
          >
            <FeatBadge size={unit(24)} tone={highlight.tone} />
            <View style={styles.highlightText}>
              <Text
                maxFontSizeMultiplier={maxFontSizeMultiplier}
                numberOfLines={1}
                style={[
                  styles.highlightName,
                  highlight.tone === 'defeat' && styles.defeatText,
                  { fontSize: unit(13), lineHeight: unit(16) },
                ]}
              >
                {highlight.name}
              </Text>
              <Text
                maxFontSizeMultiplier={maxFontSizeMultiplier}
                numberOfLines={1}
                style={[styles.highlightDescription, { fontSize: unit(11), lineHeight: unit(14) }]}
              >
                <Text style={styles.highlightOwner}>{highlight.owner}</Text> · {highlight.description}
              </Text>
            </View>
          </View>
        ))
      )}
      {hidden > 0 && (
        <Pressable
          accessibilityLabel={`${hidden} more in the recap`}
          accessibilityRole="button"
          hitSlop={unit(6)}
          onPress={onOpenRecap}
          style={({ pressed }) => [styles.moreLink, pressed && styles.pressed]}
          testID="game-recap-more"
        >
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.moreText, { fontSize: unit(12) }]}>
            +{hidden} more in the recap ›
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function ShotBubble({ by, mine, shot, unit }: { by: string; mine: boolean; shot: PartingShot; unit: Unit }) {
  return (
    <View
      accessibilityLabel={`${by} said: ${getPartingShotText(shot.lineId)}`}
      accessible
      style={[
        styles.bubble,
        mine ? styles.bubbleMine : styles.bubbleTheirs,
        { borderRadius: unit(12), paddingHorizontal: unit(10), paddingVertical: unit(5) },
      ]}
    >
      <Text
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        numberOfLines={1}
        style={[styles.bubbleBy, { fontSize: unit(10) }]}
      >
        {by}
      </Text>
      <Text
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={[styles.bubbleText, { fontSize: unit(14), lineHeight: unit(18) }]}
      >
        {getPartingShotText(shot.lineId)}
      </Text>
    </View>
  );
}

// The latest line said and one clear way to answer it.
export function LastWord({
  home,
  onOpenSheet,
  opponentName,
  options,
  shots,
  unit,
}: {
  home: Player;
  onOpenSheet: () => void;
  opponentName: string;
  options: PartingShotOptions | null;
  shots: PartingShot[];
  unit: Unit;
}) {
  const latest = shots.at(-1);
  if (!latest && !options) return null;
  const mine = latest?.playerId === home.id;

  return (
    <View style={[styles.lastWord, { gap: unit(6) }]} testID="parting-shots">
      {latest && (
        <View testID="parting-shot-latest">
          <ShotBubble by={mine ? 'You' : opponentName} mine={mine} shot={latest} unit={unit} />
        </View>
      )}
      {options ? (
        <Pressable
          accessibilityLabel={options.kind === 'comeback' ? `Fire back at ${opponentName}` : 'Get the last word'}
          accessibilityRole="button"
          onPress={onOpenSheet}
          style={({ pressed }) => [
            styles.talkButton,
            { borderRadius: unit(10), minHeight: Math.max(44, unit(40)) },
            pressed && styles.pressed,
          ]}
          testID="parting-shot-open"
        >
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.talkButtonText, { fontSize: unit(15) }]}>
            💬 {options.kind === 'comeback' ? 'Fire back' : 'Get the last word'}
          </Text>
        </Pressable>
      ) : (
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.quiet, { fontSize: unit(11) }]}>
          {mine ? 'You said your piece.' : 'They got the last word.'}
        </Text>
      )}
    </View>
  );
}

// Picking a line happens in its own sheet with the line being answered on top.
// Pick, then Send, because there is no undo.
export function PartingShotSheet({
  home,
  isSending,
  onClose,
  onSend,
  opponentName,
  options,
  shots,
  unit,
}: {
  home: Player;
  isSending: boolean;
  onClose: () => void;
  onSend: (lineId: PartingShotLineId) => void;
  opponentName: string;
  options: PartingShotOptions;
  shots: PartingShot[];
  unit: Unit;
}) {
  const [selected, setSelected] = useState<PartingShotLineId | null>(null);
  const answering = options.kind === 'comeback' ? shots.findLast((shot) => shot.playerId !== home.id) : undefined;
  const titleRef = useRef<AccessibilityTargetRef | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => focusAccessibilityTarget(titleRef.current));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <View style={styles.sheetHost} testID="parting-shot-sheet-host">
      <Pressable
        accessibilityLabel="Cancel"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.scrim}
        testID="parting-shot-scrim"
      />
      <View
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        role="dialog"
        style={[
          styles.sheet,
          {
            borderTopLeftRadius: unit(18),
            borderTopRightRadius: unit(18),
            gap: unit(8),
            paddingBottom: unit(16),
            paddingHorizontal: unit(14),
            paddingTop: unit(10),
          },
        ]}
        testID="parting-shot-sheet"
      >
        <View style={[styles.grabber, { borderRadius: unit(2), height: unit(4), width: unit(40) }]} />
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={maxFontSizeMultiplier}
          ref={titleRef}
          style={[styles.sheetTitle, { fontSize: unit(22), lineHeight: unit(26) }]}
        >
          {options.kind === 'comeback' ? 'Fire back' : 'Get the last word'}
        </Text>
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.quiet, { fontSize: unit(12) }]}>
          {options.kind === 'comeback' ? 'One comeback. Make it count.' : 'One shot. No take-backs.'}
        </Text>
        {answering && <ShotBubble by={opponentName} mine={false} shot={answering} unit={unit} />}
        <View accessibilityRole="radiogroup" style={{ gap: unit(6) }}>
          {options.lines.map((line) => {
            const isSelected = selected === line.id;
            return (
              <Pressable
                accessibilityLabel={line.text}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected, disabled: isSending }}
                disabled={isSending}
                key={line.id}
                onPress={() => setSelected(line.id)}
                style={({ pressed }) => [
                  styles.option,
                  isSelected && styles.optionSelected,
                  {
                    borderRadius: unit(10),
                    gap: unit(8),
                    minHeight: Math.max(44, unit(44)),
                    paddingHorizontal: unit(12),
                  },
                  pressed && styles.pressed,
                ]}
                testID={`parting-shot-${line.id}`}
              >
                <Text
                  maxFontSizeMultiplier={maxFontSizeMultiplier}
                  style={[styles.optionText, isSelected && styles.optionTextSelected, { fontSize: unit(14) }]}
                >
                  {line.text}
                </Text>
                <View
                  style={[
                    styles.radio,
                    isSelected && styles.radioSelected,
                    { borderRadius: unit(10), height: unit(20), width: unit(20) },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.sheetActions, { gap: unit(8), marginTop: unit(4) }]}>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.sheetButton,
              styles.sheetCancel,
              { borderRadius: unit(10), minHeight: Math.max(44, unit(48)) },
              pressed && styles.pressed,
            ]}
            testID="parting-shot-cancel"
          >
            <Text
              maxFontSizeMultiplier={maxFontSizeMultiplier}
              style={[styles.sheetCancelText, { fontSize: unit(16) }]}
            >
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel={selected ? `Send: ${getPartingShotText(selected)}` : 'Send. Pick a line first.'}
            accessibilityRole="button"
            accessibilityState={{ disabled: !selected || isSending }}
            disabled={!selected || isSending}
            onPress={() => selected && onSend(selected)}
            style={({ pressed }) => [
              styles.sheetButton,
              styles.sheetSend,
              { borderRadius: unit(10), minHeight: Math.max(44, unit(48)) },
              (!selected || isSending) && styles.disabled,
              pressed && styles.pressed,
            ]}
            testID="parting-shot-send"
          >
            <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.sheetSendText, { fontSize: unit(16) }]}>
              {isSending ? 'Sending…' : 'Send'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

type TapeRow = {
  detail?: [home: string, opponent: string];
  label: string;
  values: [home: number, opponent: number];
  text?: [home: string, opponent: string];
};

function TapeRowView({ opponentName, row, unit }: { opponentName: string; row: TapeRow; unit: Unit }) {
  const [home, opponent] = row.values;
  const max = Math.max(home, opponent);
  const [homeText, opponentText] = row.text ?? [String(home), String(opponent)];
  const width = (value: number) => (max > 0 ? `${Math.round((value / max) * 100)}%` : '0%') as `${number}%`;
  const valueStyle = [styles.tapeValue, { fontSize: unit(16), lineHeight: unit(19), width: unit(78) }];
  const detailStyle = [styles.tapeDetail, { fontSize: unit(9), lineHeight: unit(11) }];

  return (
    <View
      accessibilityLabel={`${row.label}: you ${homeText}${row.detail?.[0] ? ` ${row.detail[0]}` : ''}, ${opponentName} ${opponentText}${row.detail?.[1] ? ` ${row.detail[1]}` : ''}`}
      accessible
      style={[styles.tapeRow, { gap: unit(8) }]}
      testID={`recap-tape-${row.label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <View>
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={valueStyle}>
          {homeText}
        </Text>
        {row.detail?.[0] ? (
          <Text
            maxFontSizeMultiplier={maxFontSizeMultiplier}
            numberOfLines={1}
            style={[detailStyle, { width: unit(78) }]}
          >
            {row.detail[0]}
          </Text>
        ) : null}
      </View>
      <View style={[styles.tapeMiddle, { gap: unit(3) }]}>
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.tapeLabel, { fontSize: unit(11) }]}>
          {row.label}
        </Text>
        <View style={[styles.tapeBars, { gap: unit(3) }]}>
          <View style={[styles.tapeTrack, styles.tapeTrackHome, { borderRadius: unit(3), height: unit(7) }]}>
            <View style={[styles.tapeFillHome, { width: width(home) }]} />
          </View>
          <View style={[styles.tapeTrack, { borderRadius: unit(3), height: unit(7) }]}>
            <View style={[styles.tapeFillOpponent, { width: width(opponent) }]} />
          </View>
        </View>
      </View>
      <View>
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[valueStyle, styles.tapeValueRight]}>
          {opponentText}
        </Text>
        {row.detail?.[1] ? (
          <Text
            maxFontSizeMultiplier={maxFontSizeMultiplier}
            numberOfLines={1}
            style={[detailStyle, styles.tapeValueRight, { width: unit(78) }]}
          >
            {row.detail[1]}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function getTapeSections(home: PlayerGameRecap, opponent: PlayerGameRecap) {
  const pair = (read: (entry: PlayerGameRecap) => number): [number, number] => [read(home), read(opponent)];
  const box = (read: (entry: PlayerGameRecap) => ScoredBox | null): Pick<TapeRow, 'detail' | 'text' | 'values'> => {
    const [mine, theirs] = [read(home), read(opponent)];
    return {
      detail: [mine ? categoryLabels[mine.category] : '', theirs ? categoryLabels[theirs.category] : ''],
      text: [mine ? String(mine.score) : '—', theirs ? String(theirs.score) : '—'],
      values: [mine?.score ?? 0, theirs?.score ?? 0],
    };
  };

  return [
    {
      rows: [
        {
          label: 'Landed',
          text: [
            `${home.punches.landed}/${home.punches.thrown}`,
            `${opponent.punches.landed}/${opponent.punches.thrown}`,
          ],
          values: pair((entry) => entry.punches.landed),
        },
        { label: 'Counterpunches', values: pair((entry) => entry.punches.counterpunchesLanded) },
        { label: 'Biggest hit', ...box((entry) => entry.punches.biggestHit) },
      ] satisfies TapeRow[],
      title: 'PUNCHES',
    },
    {
      rows: [
        { label: 'Best turn', ...box((entry) => entry.moments.bestTurn) },
        { label: 'Suckers rolled', values: pair((entry) => entry.moments.suckersRolled) },
        { label: 'Sucker Deals', values: pair((entry) => entry.moments.suckerDeals) },
      ] satisfies TapeRow[],
      title: 'MOMENTS',
    },
    {
      rows: [
        { label: 'Spent', values: pair((entry) => entry.tokens.spent) },
        { label: 'Extra Rolls', values: pair((entry) => entry.tokens.extraRolls) },
        { label: 'Mulligans', values: pair((entry) => entry.tokens.mulligans) },
        { label: 'Punches', values: pair((entry) => entry.tokens.punches) },
        { label: 'Earned', values: pair((entry) => entry.tokens.earned) },
        { label: 'Left over', values: pair((entry) => entry.tokens.left) },
      ] satisfies TapeRow[],
      title: 'TOKENS',
    },
  ];
}

function formatSwings(recap: RemoteGameRecap, home: Player, opponent: Player) {
  const changes = `${recap.leadChanges} lead change${recap.leadChanges === 1 ? '' : 's'}`;
  if (!recap.biggestLead) return changes;
  const leader = recap.biggestLead.playerId === home.id ? 'You' : opponent.name;
  return `${changes} · Biggest lead: ${leader} by ${recap.biggestLead.points}`;
}

// The full "tale of the tape", opened on purpose from the Game Over panel. It
// may scroll, like the Stats page.
export function RecapPage({
  home,
  homeScore,
  onClose,
  onOpenStats,
  opponent,
  opponentScore,
  recap,
  recapFailed,
  shots,
  statsButtonRef,
  unit,
}: {
  home: Player;
  homeScore: number;
  onClose: () => void;
  onOpenStats: () => void;
  opponent: Player;
  opponentScore: number;
  recap: RemoteGameRecap | null;
  recapFailed: boolean;
  shots: PartingShot[];
  statsButtonRef: Ref<AccessibilityTargetRef>;
  unit: Unit;
}) {
  const backRef = useRef<AccessibilityTargetRef | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => focusAccessibilityTarget(backRef.current));
    return () => cancelAnimationFrame(frame);
  }, []);
  const [mine, theirs] = [home, opponent].map((player) => recap?.players.find((entry) => entry.playerId === player.id));
  const labelStyle = [styles.label, styles.sectionLabel, { fontSize: unit(11), marginBottom: unit(2) }];
  const sectionStyle = [styles.section, { borderRadius: unit(10), gap: unit(8), padding: unit(10) }];

  return (
    <View
      accessibilityLabel="Tale of the Tape"
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
      role="dialog"
      style={[styles.page, { gap: unit(10), padding: unit(14) }]}
      testID="recap-page"
    >
      <View style={[styles.pageHeader, { gap: unit(10) }]}>
        <Pressable
          accessibilityLabel="Back to Game Over"
          accessibilityRole="button"
          onPress={onClose}
          ref={backRef}
          style={({ pressed }) => [
            styles.backButton,
            { borderRadius: unit(8), height: Math.max(44, unit(44)), width: Math.max(44, unit(44)) },
            pressed && styles.pressed,
          ]}
          testID="recap-page-back"
        >
          <BackChevronIcon size={unit(28)} strokeWidth={4.5} />
        </Pressable>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={maxFontSizeMultiplier}
          numberOfLines={1}
          style={[styles.pageTitle, { fontSize: unit(22) }]}
        >
          Tale of the Tape
        </Text>
        <View style={{ width: Math.max(44, unit(44)) }} />
      </View>
      <View style={[styles.versus, { gap: unit(8) }]} testID="recap-page-versus">
        {[
          { name: 'You', player: home, score: homeScore },
          { name: opponent.name, player: opponent, score: opponentScore },
        ].map((side, index) => (
          <View key={side.player.id} style={[styles.versusSide, index === 1 && styles.versusSideRight]}>
            <Text
              maxFontSizeMultiplier={maxFontSizeMultiplier}
              numberOfLines={1}
              style={[styles.versusName, index === 1 && styles.textRight, { fontSize: unit(12) }]}
            >
              {side.name}
            </Text>
            <Text
              maxFontSizeMultiplier={maxFontSizeMultiplier}
              style={[styles.versusScore, { fontSize: unit(28), lineHeight: unit(32) }]}
            >
              {side.score}
            </Text>
            <RatingChange result={recap?.results[side.player.id]} unit={unit} />
          </View>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ gap: unit(10), paddingBottom: unit(8) }} style={styles.pageScroll}>
        {!recap || !mine || !theirs ? (
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.quiet, { fontSize: unit(13) }]}>
            {recapFailed ? 'The recap got lost in the mail.' : 'Tallying the damage…'}
          </Text>
        ) : (
          <>
            {getTapeSections(mine, theirs).map((section) => (
              <View key={section.title} style={sectionStyle}>
                <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={labelStyle}>
                  {section.title}
                </Text>
                {section.rows.map((row) => (
                  <TapeRowView key={row.label} opponentName={opponent.name} row={row} unit={unit} />
                ))}
                {section.title === 'MOMENTS' && (
                  <Text
                    maxFontSizeMultiplier={maxFontSizeMultiplier}
                    style={[styles.quiet, { fontSize: unit(11) }]}
                    testID="game-recap-swings"
                  >
                    {formatSwings(recap, home, opponent)}
                  </Text>
                )}
              </View>
            ))}
            <View style={sectionStyle} testID="recap-page-feats">
              <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={labelStyle}>
                FEATS & DEFEATS
              </Text>
              {[home, opponent].map((player) => {
                const feats = [...(recap.results[player.id]?.feats ?? [])].sort((left, right) =>
                  left.tone === right.tone ? 0 : left.tone === 'feat' ? -1 : 1,
                );
                return (
                  <View key={player.id} style={{ gap: unit(6) }}>
                    <Text
                      maxFontSizeMultiplier={maxFontSizeMultiplier}
                      numberOfLines={1}
                      style={[styles.featOwner, { fontSize: unit(12) }]}
                    >
                      {player.id === home.id ? 'You' : player.name}
                    </Text>
                    {feats.length === 0 ? (
                      <Text
                        maxFontSizeMultiplier={maxFontSizeMultiplier}
                        style={[styles.quiet, styles.textLeft, { fontSize: unit(12) }]}
                      >
                        Nothing this game.
                      </Text>
                    ) : (
                      feats.map((feat) => (
                        <View
                          accessibilityLabel={`${feat.tone === 'feat' ? 'Feat' : 'Defeat'}: ${feat.name}. ${feat.description}`}
                          accessible
                          key={feat.key}
                          style={[styles.highlightRow, { gap: unit(8) }]}
                        >
                          <FeatBadge size={unit(22)} tone={feat.tone} />
                          <View style={styles.highlightText}>
                            <Text
                              maxFontSizeMultiplier={maxFontSizeMultiplier}
                              style={[
                                styles.highlightName,
                                feat.tone === 'defeat' && styles.defeatText,
                                { fontSize: unit(13), lineHeight: unit(16) },
                              ]}
                            >
                              {feat.name}
                            </Text>
                            <Text
                              maxFontSizeMultiplier={maxFontSizeMultiplier}
                              style={[styles.highlightDescription, { fontSize: unit(11), lineHeight: unit(14) }]}
                            >
                              {feat.description}
                            </Text>
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                );
              })}
            </View>
            {shots.length > 0 && (
              <View style={sectionStyle} testID="recap-page-shots">
                <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={labelStyle}>
                  LAST WORDS
                </Text>
                {shots.map((shot) => (
                  <ShotBubble
                    by={shot.playerId === home.id ? 'You' : opponent.name}
                    key={`${shot.playerId}-${shot.kind}`}
                    mine={shot.playerId === home.id}
                    shot={shot}
                    unit={unit}
                  />
                ))}
              </View>
            )}
          </>
        )}
        <Pressable
          accessibilityLabel="Head-to-head stats"
          accessibilityRole="button"
          onPress={onOpenStats}
          ref={statsButtonRef}
          style={({ pressed }) => [
            styles.statsLink,
            { borderRadius: unit(10), minHeight: Math.max(44, unit(48)) },
            pressed && styles.pressed,
          ]}
          testID="game-over-stats-button"
        >
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.statsLinkText, { fontSize: unit(16) }]}>
            Head-to-head stats ›
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderWidth: 2,
    justifyContent: 'center',
  },
  badge: {
    alignItems: 'center',
    borderWidth: 2,
    justifyContent: 'center',
  },
  badgeDefeat: {
    backgroundColor: '#3A0A0A',
    borderColor: '#F12D22',
  },
  badgeFeat: {
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
  },
  badgeText: {
    color: '#210505',
    fontFamily: black,
    fontWeight: '900',
    textAlign: 'center',
  },
  badgeTextDefeat: {
    color: '#FF8A80',
  },
  bubble: {
    borderWidth: 2,
    maxWidth: '88%',
  },
  bubbleBy: {
    color: '#8F3B10',
    fontFamily: extraBold,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
  },
  bubbleText: {
    color: '#210505',
    fontFamily: black,
    fontWeight: '900',
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
  },
  defeatText: {
    color: '#FF8A80',
  },
  disabled: {
    opacity: 0.45,
  },
  featOwner: {
    color: '#FFB000',
    fontFamily: black,
    fontWeight: '900',
  },
  grabber: {
    alignSelf: 'center',
    backgroundColor: '#8F3B10',
  },
  highlightDescription: {
    color: '#FFF3C2',
    fontFamily: extraBold,
    opacity: 0.85,
  },
  highlightName: {
    color: '#FFD329',
    fontFamily: black,
    fontWeight: '900',
  },
  highlightOwner: {
    color: '#FFB000',
    fontFamily: black,
    fontWeight: '900',
  },
  highlightRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  highlights: {
    alignSelf: 'stretch',
  },
  highlightText: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    color: '#FFB000',
    fontFamily: black,
    fontWeight: '900',
    letterSpacing: 1,
  },
  lastWord: {
    alignSelf: 'stretch',
  },
  moreLink: {
    alignSelf: 'flex-start',
  },
  moreText: {
    color: '#FFD329',
    fontFamily: black,
    fontWeight: '900',
    textDecorationLine: 'underline',
  },
  option: {
    alignItems: 'center',
    backgroundColor: '#3A0A0A',
    borderColor: '#8F3B10',
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  optionSelected: {
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
  },
  optionText: {
    color: '#FFF3C2',
    flex: 1,
    fontFamily: black,
    fontWeight: '900',
  },
  optionTextSelected: {
    color: '#210505',
  },
  page: {
    backgroundColor: '#8F0000',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 3,
  },
  pageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  pageScroll: {
    flex: 1,
  },
  pageTitle: {
    color: '#FFF3C2',
    flex: 1,
    fontFamily: black,
    fontWeight: '900',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  quiet: {
    color: '#FFF3C2',
    fontFamily: extraBold,
    opacity: 0.8,
    textAlign: 'center',
  },
  radio: {
    borderColor: '#8F3B10',
    borderWidth: 2,
  },
  radioSelected: {
    backgroundColor: '#F12D22',
    borderColor: '#210505',
    borderWidth: 5,
  },
  rating: {
    fontFamily: black,
    fontWeight: '900',
    overflow: 'hidden',
  },
  ratingDown: {
    backgroundColor: '#3A0A0A',
    color: '#FF8A80',
  },
  ratingUp: {
    backgroundColor: '#0E3A12',
    color: '#7CFF8A',
  },
  scrim: {
    backgroundColor: 'rgba(5, 0, 0, 0.55)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  section: {
    backgroundColor: '#3A0A0A',
    borderColor: '#8F3B10',
    borderWidth: 2,
  },
  sectionLabel: {
    textAlign: 'center',
  },
  sheet: {
    backgroundColor: '#210505',
    borderColor: '#FFD329',
    borderBottomWidth: 0,
    borderWidth: 4,
  },
  sheetActions: {
    flexDirection: 'row',
  },
  sheetButton: {
    alignItems: 'center',
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
  },
  sheetCancel: {
    backgroundColor: '#3A0A0A',
    borderColor: '#8F3B10',
  },
  sheetCancelText: {
    color: '#FFF3C2',
    fontFamily: black,
    fontWeight: '900',
  },
  sheetHost: {
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 4,
  },
  sheetSend: {
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
  },
  sheetSendText: {
    color: '#210505',
    fontFamily: black,
    fontWeight: '900',
  },
  sheetTitle: {
    color: '#FFD329',
    fontFamily: black,
    fontWeight: '900',
    textAlign: 'center',
  },
  statsLink: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderWidth: 3,
    justifyContent: 'center',
  },
  statsLinkText: {
    color: '#FFD329',
    fontFamily: black,
    fontWeight: '900',
  },
  talkButton: {
    alignItems: 'center',
    borderColor: '#FFD329',
    borderStyle: 'dashed',
    borderWidth: 2,
    justifyContent: 'center',
  },
  talkButtonText: {
    color: '#FFD329',
    fontFamily: black,
    fontWeight: '900',
  },
  tapeBars: {
    flexDirection: 'row',
  },
  tapeDetail: {
    color: '#FFF3C2',
    fontFamily: extraBold,
    opacity: 0.75,
  },
  tapeFillHome: {
    alignSelf: 'flex-end',
    backgroundColor: '#FFD329',
    height: '100%',
  },
  tapeFillOpponent: {
    backgroundColor: '#FF8A80',
    height: '100%',
  },
  tapeLabel: {
    color: '#FFF3C2',
    fontFamily: extraBold,
    textAlign: 'center',
  },
  tapeMiddle: {
    flex: 1,
  },
  tapeRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  tapeTrack: {
    backgroundColor: '#210505',
    flex: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  tapeTrackHome: {
    justifyContent: 'flex-end',
  },
  tapeValue: {
    color: '#FFD329',
    fontFamily: black,
    fontWeight: '900',
  },
  tapeValueRight: {
    color: '#FF8A80',
    textAlign: 'right',
  },
  textLeft: {
    textAlign: 'left',
  },
  textRight: {
    textAlign: 'right',
  },
  versus: {
    flexDirection: 'row',
  },
  versusName: {
    color: '#FFF3C2',
    fontFamily: black,
    fontWeight: '900',
  },
  versusScore: {
    color: '#FFD329',
    fontFamily: black,
    fontWeight: '900',
  },
  versusSide: {
    alignItems: 'flex-start',
    flex: 1,
    minWidth: 0,
  },
  versusSideRight: {
    alignItems: 'flex-end',
  },
});
