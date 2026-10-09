import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import App from './App';
import './styles.css';

const theme = createTheme({
  palette: { primary: { main: '#1b5d4a' }, secondary: { main: '#cbe79c' }, background: { default: '#f6f7f9', paper: '#ffffff' }, text: { primary: '#192b32', secondary: '#7b858e' }, error: { main: '#bb4d49' } },
  typography: { fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif', button: { textTransform: 'none', fontWeight: 600 }, h4: { fontWeight: 650, letterSpacing: '-1px' }, h5: { fontWeight: 650 }, h6: { fontWeight: 650, fontSize: '1.1rem' } },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 8, padding: '9px 17px', fontSize: 13 } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiOutlinedInput: { styleOverrides: { root: { fontSize: 14, backgroundColor: '#fff' } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: '#edf0f2', fontSize: 13, padding: '17px 20px' }, head: { color: '#7b858e', background: '#fafbfc', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
    MuiAlert: { styleOverrides: { root: { fontSize: 13 } } },
  },
});
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><BrowserRouter><App /></BrowserRouter></ThemeProvider></React.StrictMode>);
