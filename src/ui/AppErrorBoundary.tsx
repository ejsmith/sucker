import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from './Pressable';

type State = {
  error: Error | null;
  resetKey: number;
};

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unexpected application render error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View accessibilityViewIsModal role="alert" style={styles.screen}>
          <Text accessibilityRole="header" style={styles.title}>
            Something went wrong
          </Text>
          <Text style={styles.body}>Sucker! hit an unexpected problem. Try reopening the current screen.</Text>
          <Pressable
            onPress={() => this.setState((state) => ({ error: null, resetKey: state.resetKey + 1 }))}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View key={this.state.resetKey} style={styles.content}>
        {this.props.children}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  body: {
    color: '#FFF3C2',
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#FFD329',
    borderRadius: 12,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  buttonText: {
    color: '#210505',
    fontSize: 16,
    fontWeight: '900',
  },
  content: {
    flex: 1,
  },
  screen: {
    alignItems: 'center',
    backgroundColor: '#8F0000',
    flex: 1,
    gap: 18,
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    color: '#FFD329',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
});
