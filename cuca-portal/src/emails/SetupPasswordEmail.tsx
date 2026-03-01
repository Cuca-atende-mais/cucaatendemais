import {
    Body,
    Button,
    Container,
    Head,
    Heading,
    Hr,
    Html,
    Img,
    Link,
    Preview,
    Section,
    Text,
} from '@react-email/components';
import * as React from 'react';

interface SetupPasswordEmailProps {
    nome: string;
    setupLink: string;
}

export const SetupPasswordEmail = ({
    nome,
    setupLink,
}: SetupPasswordEmailProps) => {
    return (
        <Html>
            <Head />
            <Preview>Acesso ao Cuca Portal: Crie sua senha</Preview>
            <Body style={main}>
                <Container style={container}>
                    <Section style={header}>
                        <Heading style={heading}>Bem-vindo ao Cuca Portal!</Heading>
                    </Section>

                    <Text style={paragraph}>Olá, {nome}!</Text>
                    <Text style={paragraph}>
                        Sua conta no <strong>Cuca Portal</strong> foi criada com sucesso.
                        Para começar a acessar o painel de gestão da Juventude, você precisa definir uma senha pessoal e intransferível.
                    </Text>

                    <Section style={buttonContainer}>
                        <Button style={button} href={setupLink}>
                            Definir Minha Senha
                        </Button>
                    </Section>

                    <Text style={paragraph}>
                        Este link é válido por <strong>48 horas</strong>. Se você não solicitou este acesso, pode ignorar este e-mail em segurança.
                    </Text>

                    <Hr style={hr} />

                    <Text style={footer}>
                        Caso o botão não funcione, copie e cole o seguinte link no seu navegador:
                        <br />
                        <Link href={setupLink} style={link}>{setupLink}</Link>
                    </Text>

                    <Text style={footerTitle}>Prefeitura de Fortaleza - Coordenadoria Especial de Políticas Públicas de Juventude</Text>
                </Container>
            </Body>
        </Html>
    );
};

export default SetupPasswordEmail;

const main = {
    backgroundColor: '#f6f9fc',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
    backgroundColor: '#ffffff',
    margin: '0 auto',
    padding: '20px 0 48px',
    marginBottom: '64px',
    borderRadius: '12px',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
};

const header = {
    padding: '32px 48px',
    backgroundColor: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px',
    textAlign: 'center' as const,
};

const heading = {
    fontSize: '24px',
    letterSpacing: '-0.5px',
    lineHeight: '1.3',
    fontWeight: '700',
    color: '#0f172a',
    margin: '0',
};

const paragraph = {
    margin: '0 0 15px',
    fontSize: '16px',
    lineHeight: '1.6',
    color: '#334155',
    padding: '0 48px',
};

const buttonContainer = {
    padding: '27px 48px 27px',
    textAlign: 'center' as const,
};

const button = {
    backgroundColor: '#2563eb',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '16px',
    fontWeight: '600',
    textDecoration: 'none',
    textAlign: 'center' as const,
    display: 'inline-block',
    padding: '12px 24px',
};

const hr = {
    borderColor: '#e2e8f0',
    margin: '32px 48px',
};

const footer = {
    color: '#64748b',
    fontSize: '14px',
    margin: '0',
    padding: '0 48px',
    lineHeight: '1.5',
};

const footerTitle = {
    color: '#94a3b8',
    fontSize: '12px',
    margin: '24px 0 0',
    padding: '0 48px',
    textAlign: 'center' as const,
    fontWeight: '500',
};

const link = {
    color: '#2563eb',
    textDecoration: 'underline',
};
