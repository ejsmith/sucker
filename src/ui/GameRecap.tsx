import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { categoryLabels, type PartingShot, type Player } from '../game';
import type { PlayerGameRecap, ScoredBox } from '../../shared/gameRecap';
import { getPartingShotText, type PartingShotLineId, type PartingShotOptions } from '../../shared/partingShots';
import type { RecapFeat, RemoteGameRecap } from '../multiplayer/gameRecap';
import { Pressable } from './Pressable';

const maxFontSizeMultiplier = 1.2;
const maxFeatsShown = 3;
const recapPages = ['Punches', 'Moments', 'Tokens'] as const;
type RecapPage = (typeof recapPages)[number];
type StatRow = [label: string, home: string, opponent: string];

// Fills the multiplayer Game Over panel between the scores and the Rematch
// button: rating change, feats, a paged stat sheet, and the parting shots.
export function GameRecap({
  homePlayer,
  isSending,
  onSendPartingShot,
  opponentPlayer,
  partingShotOptions,
  partingShots,
  recap,
  recapFailed,
  unit,
}: {
  homePlayer: Player;
  isSending: boolean;
  onSendPartingShot: (lineId: PartingShotLineId) => void;
  opponentPlayer: Player;
  partingShotOptions: PartingShotOptions | null;
  partingShots: PartingShot[];
  recap: RemoteGameRecap | null;
  recapFailed: boolean;
  unit: (value: number) => number;
}) {
  const [page, setPage] = useState<RecapPage>('Punches');
  const players = [homePlayer, opponentPlayer];
  const labelStyle = [styles.sectionLabel, { fontSize: unit(11), letterSpacing: unit(1) }];

  return (
    <View style={[styles.recap, { gap: unit(8) }]} testID="game-recap">
      {recap ? (
        <>
          <RatingRow players={players} recap={recap} unit={unit} />
          <View style={{ gap: unit(4) }} testID="game-recap-feats">
            <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={labelStyle}>
              FEATS & DEFEATS
            </Text>
            {players.every((player) => !recap.results[player.id]?.feats.length) ? (
              <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.quiet, { fontSize: unit(12) }]}>
                Nothing to brag about. Nothing to hide.
              </Text>
            ) : (
              players.map((player) => (
                <FeatRow
                  feats={recap.results[player.id]?.feats ?? []}
                  key={player.id}
                  name={player.id === homePlayer.id ? 'You' : player.name}
                  unit={unit}
                />
              ))
            )}
          </View>
          <View
            style={[styles.sheet, { borderRadius: unit(9), gap: unit(4), padding: unit(6) }]}
            testID="game-recap-sheet"
          >
            <View accessibilityRole="tablist" style={[styles.tabs, { gap: unit(4) }]}>
              {recapPages.map((tab) => (
                <Pressable
                  accessibilityLabel={tab}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === page }}
                  hitSlop={unit(4)}
                  key={tab}
                  onPress={() => setPage(tab)}
                  style={({ pressed }) => [
                    styles.tab,
                    { borderRadius: unit(7), minHeight: Math.max(32, unit(30)) },
                    tab === page && styles.tabSelected,
                    pressed && styles.pressed,
                  ]}
                  testID={`game-recap-tab-${tab.toLowerCase()}`}
                >
                  <Text
                    maxFontSizeMultiplier={maxFontSizeMultiplier}
                    style={[styles.tabText, { fontSize: unit(12) }, tab === page && styles.tabTextSelected]}
                  >
                    {tab}
                  </Text>
                </Pressable>
              ))}
            </View>
            <StatTable
              opponentName={opponentPlayer.name}
              rows={getStatRows(page, recap, homePlayer, opponentPlayer)}
              unit={unit}
            />
            {page === 'Moments' && (
              <Text
                maxFontSizeMultiplier={maxFontSizeMultiplier}
                style={[styles.quiet, { fontSize: unit(11) }]}
                testID="game-recap-swings"
              >
                {formatSwings(recap, homePlayer, opponentPlayer)}
              </Text>
            )}
          </View>
        </>
      ) : (
        <Text
          maxFontSizeMultiplier={maxFontSizeMultiplier}
          style={[styles.quiet, { fontSize: unit(12) }]}
          testID="game-recap-loading"
        >
          {recapFailed ? 'The recap got lost in the mail.' : 'Tallying the damage…'}
        </Text>
      )}
      <PartingShots
        homePlayer={homePlayer}
        isSending={isSending}
        labelStyle={labelStyle}
        onSend={onSendPartingShot}
        opponentName={opponentPlayer.name}
        options={partingShotOptions}
        shots={partingShots}
        unit={unit}
      />
    </View>
  );
}

function RatingRow({
  players,
  recap,
  unit,
}: {
  players: Player[];
  recap: RemoteGameRecap;
  unit: (value: number) => number;
}) {
  const ratings = players.map((player) => recap.results[player.id]);
  if (ratings.some((result) => result?.ratingBefore == null || result?.ratingAfter == null)) return null;

  return (
    <View style={[styles.ratingRow, { gap: unit(8) }]} testID="game-recap-ratings">
      {ratings.map((result, index) => {
        const before = Math.round(result!.ratingBefore!);
        const after = Math.round(result!.ratingAfter!);
        const change = after - before;
        return (
          <Text
            accessibilityLabel={`Rating ${before} to ${after}`}
            key={players[index].id}
            maxFontSizeMultiplier={maxFontSizeMultiplier}
            style={[styles.rating, { fontSize: unit(12) }]}
          >
            {before} → {after}{' '}
            <Text style={change >= 0 ? styles.ratingUp : styles.ratingDown}>
              ({change >= 0 ? '+' : '−'}
              {Math.abs(change)})
            </Text>
          </Text>
        );
      })}
    </View>
  );
}

function FeatRow({ feats, name, unit }: { feats: RecapFeat[]; name: string; unit: (value: number) => number }) {
  const shown = feats.slice(0, maxFeatsShown);
  const hidden = feats.length - shown.length;

  return (
    <View style={[styles.featChips, { gap: unit(4) }]}>
      <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.featOwner, { fontSize: unit(11) }]}>
        {name}:
      </Text>
      {feats.length === 0 ? (
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.quiet, { fontSize: unit(11) }]}>
          —
        </Text>
      ) : (
        shown.map((feat) => (
          <Text
            accessibilityLabel={`${feat.tone === 'feat' ? 'Feat' : 'Defeat'}: ${feat.name}. ${feat.description}`}
            key={feat.key}
            maxFontSizeMultiplier={maxFontSizeMultiplier}
            style={[
              styles.chip,
              feat.tone === 'feat' ? styles.featChip : styles.defeatChip,
              { borderRadius: unit(6), fontSize: unit(11), paddingHorizontal: unit(6), paddingVertical: unit(2) },
            ]}
          >
            {feat.name}
          </Text>
        ))
      )}
      {hidden > 0 && (
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.quiet, { fontSize: unit(11) }]}>
          +{hidden} more
        </Text>
      )}
    </View>
  );
}

function StatTable({
  opponentName,
  rows,
  unit,
}: {
  opponentName: string;
  rows: StatRow[];
  unit: (value: number) => number;
}) {
  const cell = { fontSize: unit(12), lineHeight: unit(17) };

  return (
    <View testID="game-recap-table">
      <View style={styles.tableRow}>
        <Text style={[styles.tableLabel, cell]} />
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.tableHead, cell]}>
          You
        </Text>
        <Text maxFontSizeMultiplier={maxFontSizeMultiplier} numberOfLines={1} style={[styles.tableHead, cell]}>
          {opponentName}
        </Text>
      </View>
      {rows.map(([label, home, opponent]) => (
        <View
          accessibilityLabel={`${label}: you ${home}, ${opponentName} ${opponent}`}
          accessible
          key={label}
          style={styles.tableRow}
        >
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.tableLabel, cell]}>
            {label}
          </Text>
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} numberOfLines={2} style={[styles.tableValue, cell]}>
            {home}
          </Text>
          <Text maxFontSizeMultiplier={maxFontSizeMultiplier} numberOfLines={2} style={[styles.tableValue, cell]}>
            {opponent}
          </Text>
        </View>
      ))}
    </View>
  );
}

function PartingShots({
  homePlayer,
  isSending,
  labelStyle,
  onSend,
  opponentName,
  options,
  shots,
  unit,
}: {
  homePlayer: Player;
  isSending: boolean;
  labelStyle: object[];
  onSend: (lineId: PartingShotLineId) => void;
  opponentName: string;
  options: PartingShotOptions | null;
  shots: PartingShot[];
  unit: (value: number) => number;
}) {
  if (shots.length === 0 && !options) return null;

  return (
    <View style={{ gap: unit(5) }} testID="parting-shots">
      <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={labelStyle}>
        {!options ? 'LAST WORD' : options.kind === 'comeback' ? 'FIRE BACK ONCE' : 'GET THE LAST WORD'}
      </Text>
      {shots.map((shot, index) => {
        const mine = shot.playerId === homePlayer.id;
        return (
          <View
            key={`${shot.playerId}-${shot.kind}`}
            style={[
              styles.shot,
              mine ? styles.shotMine : styles.shotTheirs,
              { borderRadius: unit(9), paddingHorizontal: unit(8), paddingVertical: unit(4) },
            ]}
            testID={`parting-shot-${index}`}
          >
            <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.shotText, { fontSize: unit(13) }]}>
              “{getPartingShotText(shot.lineId)}”{' '}
              <Text style={[styles.shotBy, { fontSize: unit(10) }]}>— {mine ? 'You' : opponentName}</Text>
            </Text>
          </View>
        );
      })}
      {options && (
        <View style={[styles.options, { gap: unit(6) }]} testID="parting-shot-options">
          {options.lines.map((line) => (
            <Pressable
              accessibilityLabel={`Send: ${line.text}`}
              disabled={isSending}
              key={line.id}
              onPress={() => onSend(line.id)}
              style={({ pressed }) => [
                styles.option,
                {
                  borderRadius: unit(8),
                  minHeight: Math.max(40, unit(38)),
                  paddingHorizontal: unit(6),
                },
                pressed && styles.pressed,
                isSending && styles.disabled,
              ]}
              testID={`parting-shot-${line.id}`}
            >
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={maxFontSizeMultiplier}
                minimumFontScale={0.75}
                numberOfLines={2}
                style={[styles.optionText, { fontSize: unit(12), lineHeight: unit(15) }]}
              >
                {line.text}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function getStatRows(page: RecapPage, recap: RemoteGameRecap, home: Player, opponent: Player): StatRow[] {
  const [mine, theirs] = [home, opponent].map((player) => recap.players.find((entry) => entry.playerId === player.id));
  if (!mine || !theirs) return [];
  const row = (label: string, read: (entry: PlayerGameRecap) => string): StatRow => [label, read(mine), read(theirs)];

  switch (page) {
    case 'Punches':
      return [
        row('Thrown', (entry) => String(entry.punches.thrown)),
        row('Landed', (entry) => String(entry.punches.landed)),
        row('Counterpunches', (entry) => String(entry.punches.counterpunchesLanded)),
        row('Biggest hit', (entry) => formatBox(entry.punches.biggestHit)),
      ];
    case 'Moments':
      return [
        row('Best turn', (entry) => formatBox(entry.moments.bestTurn)),
        row('Suckers rolled', (entry) => String(entry.moments.suckersRolled)),
        row('Sucker Deals', (entry) => String(entry.moments.suckerDeals)),
      ];
    case 'Tokens':
      return [
        row('Extra Rolls', (entry) => String(entry.tokens.extraRolls)),
        row('Mulligans', (entry) => String(entry.tokens.mulligans)),
        row('Punches', (entry) => String(entry.tokens.punches)),
        row('Earned', (entry) => `+${entry.tokens.earned}`),
        row('Left over', (entry) => String(entry.tokens.left)),
      ];
  }
}

function formatBox(box: ScoredBox | null) {
  return box ? `${box.score} ${categoryLabels[box.category]}` : '—';
}

function formatSwings(recap: RemoteGameRecap, home: Player, opponent: Player) {
  const changes = `${recap.leadChanges} lead change${recap.leadChanges === 1 ? '' : 's'}`;
  if (!recap.biggestLead) return changes;
  const leader = recap.biggestLead.playerId === home.id ? 'You' : opponent.name;
  return `${changes} · Biggest lead: ${leader} by ${recap.biggestLead.points}`;
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    overflow: 'hidden',
  },
  defeatChip: {
    backgroundColor: '#3A0A0A',
    borderColor: '#F12D22',
    color: '#FF8A80',
  },
  disabled: {
    opacity: 0.5,
  },
  featChip: {
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
    color: '#210505',
  },
  featChips: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  featOwner: {
    color: '#FFF3C2',
    fontFamily: 'Inter_800ExtraBold',
  },
  option: {
    alignItems: 'center',
    backgroundColor: '#F12D22',
    borderColor: '#FFB000',
    borderWidth: 2,
    flexBasis: '47%',
    flexGrow: 1,
    justifyContent: 'center',
  },
  optionText: {
    color: '#FFD329',
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: '#050505',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  quiet: {
    color: '#FFF3C2',
    fontFamily: 'Inter_800ExtraBold',
    opacity: 0.8,
    textAlign: 'center',
  },
  rating: {
    color: '#FFF3C2',
    flex: 1,
    fontFamily: 'Inter_800ExtraBold',
    textAlign: 'center',
  },
  ratingDown: {
    color: '#FF8A80',
  },
  ratingRow: {
    flexDirection: 'row',
  },
  ratingUp: {
    color: '#7CFF8A',
  },
  recap: {
    alignSelf: 'stretch',
  },
  sectionLabel: {
    color: '#FFB000',
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    textAlign: 'center',
  },
  sheet: {
    backgroundColor: '#3A0A0A',
    borderColor: '#8F3B10',
    borderWidth: 2,
  },
  shot: {
    borderWidth: 2,
    maxWidth: '88%',
  },
  shotBy: {
    color: '#8F3B10',
    fontFamily: 'Inter_800ExtraBold',
  },
  shotMine: {
    alignSelf: 'flex-end',
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
  },
  shotText: {
    color: '#210505',
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
  },
  shotTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF3C2',
    borderColor: '#8F3B10',
  },
  tab: {
    alignItems: 'center',
    borderColor: '#8F3B10',
    borderWidth: 2,
    flex: 1,
    justifyContent: 'center',
  },
  tabSelected: {
    backgroundColor: '#FFD329',
    borderColor: '#FFF3C2',
  },
  tabText: {
    color: '#FFF3C2',
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
  },
  tabTextSelected: {
    color: '#210505',
  },
  tableHead: {
    color: '#FFB000',
    flex: 1,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    textAlign: 'right',
  },
  tableLabel: {
    color: '#FFF3C2',
    flex: 1.1,
    fontFamily: 'Inter_800ExtraBold',
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableValue: {
    color: '#FFD329',
    flex: 1,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    textAlign: 'right',
  },
  tabs: {
    flexDirection: 'row',
  },
});
