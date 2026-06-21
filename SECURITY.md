# Security Policy

## Supported Versions

Esta librería sigue [SemVer](https://semver.org/lang/es/). Solo la última versión
publicada en npm recibe correcciones de seguridad.

| Versión | Soportada |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a Vulnerability

Si encuentras una vulnerabilidad, **no abras un issue público**.

Por favor repórtala de forma privada usando
[GitHub Security Advisories](https://github.com/Isra48/rubik-lbl-ts/security/advisories/new).

Incluye, si es posible:

- Descripción del problema y su impacto.
- Pasos para reproducirlo (o una prueba de concepto).
- Versión afectada.

Intentaremos responder en un plazo de **7 días**. Agradecemos la divulgación
responsable y daremos crédito a quien lo reporte, salvo que prefiera el anonimato.

## Alcance

Este es un paquete sin dependencias en runtime y de cómputo puro (un solver de
cubo de Rubik). No realiza llamadas de red, ni accede al sistema de archivos, ni
ejecuta procesos. Reportes relevantes incluyen, por ejemplo, entradas que
provoquen consumo excesivo de memoria/CPU (DoS) o resultados incorrectos en la
validación de estados.
