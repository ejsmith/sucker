import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import type { DieValue } from '../game';

const diePipPositions: Record<DieValue, [number, number][]> = {
  1: [[34, 34]],
  2: [
    [20, 20],
    [48, 48],
  ],
  3: [
    [20, 20],
    [34, 34],
    [48, 48],
  ],
  4: [
    [20, 20],
    [48, 20],
    [20, 48],
    [48, 48],
  ],
  5: [
    [20, 20],
    [48, 20],
    [34, 34],
    [20, 48],
    [48, 48],
  ],
  6: [
    [20, 18],
    [48, 18],
    [20, 34],
    [48, 34],
    [20, 50],
    [48, 50],
  ],
};

export function DieFace({
  face,
  style,
  variant = 'white',
}: {
  face: DieValue;
  style?: StyleProp<ViewStyle>;
  variant?: 'background' | 'pips' | 'white';
}) {
  const pipColor = variant === 'background' ? '#B91510' : variant === 'pips' ? '#FFFFFF' : '#414141';

  return (
    <View style={style}>
      <Svg height="100%" viewBox="0 0 68 68" width="100%">
        {variant === 'background' && (
          <>
            <Rect fill="#5A1308" height={61} rx={11} width={61} x={4} y={5} />
            <Rect fill="#7A1208" height={61} rx={11} stroke="#5A1308" strokeWidth={1.5} width={61} x={2} y={2} />
          </>
        )}
        {variant === 'white' && (
          <>
            <Rect fill="#EEEEEE" height={66} rx={11} stroke="#838383" strokeWidth={1.5} width={66} x={1} y={1} />
            <Rect fill="#FFFFFF" height={60} rx={9} width={60} x={4} y={4} />
          </>
        )}
        {diePipPositions[face].map(([cx, cy]) => (
          <Circle cx={cx} cy={cy} fill={pipColor} key={`${cx}:${cy}`} r={variant === 'pips' ? 7 : 6} />
        ))}
      </Svg>
    </View>
  );
}
