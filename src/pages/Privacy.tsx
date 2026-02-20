import { useState } from 'react';
import { motion } from 'framer-motion';
import {
    FEATURES,
    DATA_LOCATIONS,
    calculatePrivacyScore,
    getPrivacyLevel,
} from '../data/privacyData';
import './Privacy.css';

export function Privacy() {
    const [expandedFeature, setExpandedFeature] = useState<string | null>(null);

    // Calculate overall privacy index
    const overallScore = Math.round(
        FEATURES.reduce((sum, f) => sum + calculatePrivacyScore(f).score, 0) /
            FEATURES.length,
    );
    const overallLevel = getPrivacyLevel(overallScore);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: { staggerChildren: 0.1, delayChildren: 0.2 },
        },
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0 },
    };

    return (
        <motion.div
            className="privacy-container"
            initial="hidden"
            animate="visible"
            variants={containerVariants}
        >
            {/* Header */}
            <motion.div className="privacy-header" variants={itemVariants}>
                <h1>🔒 Privacy & Data Transparency</h1>
                <p>
                    Learn where your data is stored and how it's managed across
                    MyHue features
                </p>
            </motion.div>

            {/* Overall Privacy Index */}
            <motion.div className="privacy-index" variants={itemVariants}>
                <div className="index-card">
                    <div className="index-header">
                        <h2>MyHue Privacy Index</h2>
                        <span className="index-score-badge">
                            {overallScore}
                            <span className="index-max">/100</span>
                        </span>
                    </div>

                    <div className="index-gauge">
                        <div
                            className="gauge-fill"
                            style={{
                                width: `${overallScore}%`,
                                backgroundColor: overallLevel.color,
                            }}
                        />
                    </div>

                    <div className="index-level">
                        <span className="level-icon">{overallLevel.icon}</span>
                        <span className="level-text">
                            {overallLevel.level} Privacy
                        </span>
                    </div>

                    <div className="index-description">
                        <p>
                            Your MyHue application maintains strong privacy
                            practices by keeping most data on your local network
                            and devices. The main privacy factors are:
                        </p>
                        <ul style={{ marginTop: '1rem', fontSize: '0.95rem' }}>
                            <li>
                                ✅ Local-first: Hue Bridge, Xiaomi Hub, and
                                Stats are 100% local
                            </li>
                            <li>
                                ✅ No surveillance: Cast device discovery via
                                mDNS (local)
                            </li>
                            <li>
                                ⚠️ Cloud AI: Agent uses Groq API for LLM
                                processing
                            </li>
                            <li>
                                ⚠️ YouTube: OAuth and playlist data via Google
                                Cloud
                            </li>
                        </ul>
                    </div>
                </div>
            </motion.div>

            {/* Features Grid */}
            <motion.div className="features-section" variants={itemVariants}>
                <h2>Privacy by Feature</h2>

                <div className="features-grid">
                    {FEATURES.map((feature) => {
                        const { score, breakdown } =
                            calculatePrivacyScore(feature);
                        const level = getPrivacyLevel(score);
                        const isExpanded = expandedFeature === feature.id;

                        return (
                            <motion.div
                                key={feature.id}
                                className={`feature-card ${isExpanded ? 'expanded' : ''}`}
                                variants={itemVariants}
                                layout
                            >
                                {/* Card Header */}
                                <button
                                    className="feature-card-header"
                                    onClick={() =>
                                        setExpandedFeature(
                                            isExpanded ? null : feature.id,
                                        )
                                    }
                                >
                                    <div className="feature-info">
                                        <span className="feature-icon">
                                            {feature.icon}
                                        </span>
                                        <div className="feature-name">
                                            <h3>{feature.name}</h3>
                                            <p className="feature-description">
                                                {feature.description}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="feature-score">
                                        <div
                                            className="score-circle"
                                            style={{ borderColor: level.color }}
                                        >
                                            <span className="score-value">
                                                {score}
                                            </span>
                                        </div>
                                        <div
                                            className="score-level"
                                            style={{ color: level.color }}
                                        >
                                            {level.level}
                                        </div>
                                    </div>
                                </button>

                                {/* Expanded Content */}
                                {isExpanded && (
                                    <motion.div
                                        className="feature-content"
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                    >
                                        {/* Data Locations */}
                                        <div className="content-section">
                                            <h4>📍 Where Data Is Stored</h4>
                                            {feature.dataLocations.map(
                                                (loc, idx) => (
                                                    <div
                                                        key={idx}
                                                        className="data-location"
                                                    >
                                                        <div className="location-header">
                                                            <span
                                                                className="location-icon"
                                                                style={{
                                                                    color: loc
                                                                        .location
                                                                        .color,
                                                                }}
                                                            >
                                                                {
                                                                    loc.location
                                                                        .icon
                                                                }
                                                            </span>
                                                            <div className="location-info">
                                                                <strong>
                                                                    {
                                                                        loc
                                                                            .location
                                                                            .name
                                                                    }
                                                                </strong>
                                                                <p className="location-desc">
                                                                    {
                                                                        loc
                                                                            .location
                                                                            .description
                                                                    }
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <ul className="location-details">
                                                            {loc.details.map(
                                                                (detail, i) => (
                                                                    <li key={i}>
                                                                        {detail}
                                                                    </li>
                                                                ),
                                                            )}
                                                        </ul>
                                                    </div>
                                                ),
                                            )}
                                        </div>

                                        {/* Authentication */}
                                        <div className="content-section">
                                            <h4>🔐 Authentication</h4>
                                            <div className="auth-info">
                                                <p>
                                                    <strong>
                                                        Authentication Required:
                                                    </strong>{' '}
                                                    {feature.authentication
                                                        .required
                                                        ? '✅ Yes'
                                                        : '❌ No'}
                                                </p>
                                                {feature.authentication
                                                    .type && (
                                                    <p>
                                                        <strong>Type:</strong>{' '}
                                                        {
                                                            feature
                                                                .authentication
                                                                .type
                                                        }
                                                    </p>
                                                )}
                                                {feature.authentication
                                                    .externalProvider && (
                                                    <p>
                                                        <strong>
                                                            Provider:
                                                        </strong>{' '}
                                                        {
                                                            feature
                                                                .authentication
                                                                .externalProvider
                                                        }
                                                    </p>
                                                )}
                                                {feature.authentication
                                                    .storedCredentials && (
                                                    <p className="warning">
                                                        <strong>
                                                            ⚠️ Credentials are
                                                            stored
                                                        </strong>{' '}
                                                        on server-side
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Privacy Score Breakdown */}
                                        <div className="content-section">
                                            <h4>
                                                📈 Privacy Score Breakdown (
                                                {score}/100)
                                            </h4>
                                            <div className="score-breakdown">
                                                {Object.entries(breakdown).map(
                                                    ([factor, value]) => (
                                                        <div
                                                            key={factor}
                                                            className="breakdown-item"
                                                        >
                                                            <div className="breakdown-label">
                                                                {factor
                                                                    .charAt(0)
                                                                    .toUpperCase() +
                                                                    factor.slice(
                                                                        1,
                                                                    )}
                                                            </div>
                                                            <div className="breakdown-bar">
                                                                <div
                                                                    className="breakdown-fill"
                                                                    style={{
                                                                        width: `${Math.min(value, 30)}%`,
                                                                    }}
                                                                />
                                                            </div>
                                                            <div className="breakdown-value">
                                                                {Math.round(
                                                                    value,
                                                                )}
                                                            </div>
                                                        </div>
                                                    ),
                                                )}
                                            </div>
                                        </div>

                                        {/* Risks */}
                                        {feature.risks.length > 0 && (
                                            <div className="content-section">
                                                <h4>
                                                    ⚠️ Privacy Considerations
                                                </h4>
                                                <ul className="risks-list">
                                                    {feature.risks.map(
                                                        (risk, i) => (
                                                            <li
                                                                key={i}
                                                                className="risk-item"
                                                            >
                                                                {risk}
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            </div>
                                        )}

                                        {/* Positives */}
                                        {feature.positives.length > 0 && (
                                            <div className="content-section">
                                                <h4>✅ Privacy Strengths</h4>
                                                <ul className="positives-list">
                                                    {feature.positives.map(
                                                        (positive, i) => (
                                                            <li key={i}>
                                                                {positive}
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </motion.div>
                        );
                    })}
                </div>
            </motion.div>

            {/* Data Flow Diagram */}
            <motion.div
                className="data-locations-section"
                variants={itemVariants}
            >
                <h2>Data Storage Overview</h2>
                <div className="locations-grid">
                    {Object.entries(DATA_LOCATIONS).map(([key, location]) => (
                        <div key={key} className="location-card">
                            <div
                                className="location-icon"
                                style={{ color: location.color }}
                            >
                                {location.icon}
                            </div>
                            <h3>{location.name}</h3>
                            <p>{location.description}</p>
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* FAQ Section */}
            <motion.div className="faq-section" variants={itemVariants}>
                <h2>Frequently Asked Questions</h2>
                <div className="faq-grid">
                    <div className="faq-item">
                        <h4>🌐 Is my data stored in the cloud?</h4>
                        <p>
                            Most of MyHue data stays on your local network. Only
                            YouTube integration uses Google Cloud (for OAuth and
                            playlist metadata).
                        </p>
                    </div>
                    <div className="faq-item">
                        <h4>🔑 How are credentials handled?</h4>
                        <p>
                            API tokens are stored server-side only (not in your
                            browser). OAuth tokens are encrypted and never leave
                            the server.
                        </p>
                    </div>
                    <div className="faq-item">
                        <h4>📡 Can I disable cloud features?</h4>
                        <p>
                            Yes! You don't need to connect YouTube. All other
                            features (Hue, Xiaomi, Stats, Scenes) work entirely
                            offline on your LAN.
                        </p>
                    </div>
                    <div className="faq-item">
                        <h4>🗑️ How do I clear my data?</h4>
                        <p>
                            Browser data (localStorage) can be cleared in your
                            browser settings. Server logs are ephemeral and not
                            persisted.
                        </p>
                    </div>
                    <div className="faq-item">
                        <h4>🔍 Is the source code available?</h4>
                        <p>
                            MyHue is available on GitHub. You can audit the code
                            and self-host the server for maximum privacy
                            control.
                        </p>
                    </div>
                    <div className="faq-item">
                        <h4>🛡️ What about HTTPS?</h4>
                        <p>
                            Local Hue Bridge communication uses HTTP (standard),
                            but your local network is assumed secure. HTTPS is
                            available for remote access.
                        </p>
                    </div>
                </div>
            </motion.div>

            {/* Footer */}
            <motion.div className="privacy-footer" variants={itemVariants}>
                <p>
                    Last Updated:{' '}
                    {new Date().toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    })}
                </p>
                <p className="footer-note">
                    This privacy documentation is for transparency. Your actual
                    privacy depends on proper configuration and network
                    security.
                </p>
            </motion.div>
        </motion.div>
    );
}
