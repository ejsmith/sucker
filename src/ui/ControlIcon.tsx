import Svg, { Path } from 'react-native-svg';

type ControlIconProps = {
  color?: string;
  size?: number;
  strokeWidth?: number;
  testID?: string;
};

export function BackChevronIcon({ color = '#FFF3C2', size = 24, strokeWidth = 4, testID }: ControlIconProps) {
  return (
    <Svg height={size} testID={testID} viewBox="0 0 24 24" width={size}>
      <Path
        d="M15 18 9 12l6-6"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </Svg>
  );
}

export function CloseIcon({ color = '#FFF3C2', size = 20, strokeWidth = 3.2, testID }: ControlIconProps) {
  return (
    <Svg height={size} testID={testID} viewBox="0 0 24 24" width={size}>
      <Path d="M7 7l10 10M17 7 7 17" fill="none" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} />
    </Svg>
  );
}
